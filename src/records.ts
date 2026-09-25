import { isIP } from "node:net"
import { fitsDnsName, toHostname, toWildcard } from "./hostname.ts"
import type { DnsRecord, DnsRecordType } from "./pb.ts"
import type { getNetworkMembers } from "./zt.ts"

type NetworkMember = Awaited<ReturnType<typeof getNetworkMembers>>[number]

export interface RecordGroup {
    /** bare subdomain, relative to the registrable domain, as writes take it */
    name: string
    type: DnsRecordType
    contents: Set<string>
}

/** keyed by type and name, the pair porkbun treats as one rrset */
export type DesiredRecords = Map<string, RecordGroup>

export interface RecordPlan {
    creates: { name: string; type: DnsRecordType; content: string }[]
    edits: { id: string; name: string; type: DnsRecordType; content: string }[]
    deletes: DnsRecord[]
    /** how many records we own right now, for the prune ratio guard */
    managedCount: number
}

const groupKey = (type: DnsRecordType, name: string) => `${type}|${name}`

function addContent(
    into: DesiredRecords,
    name: string,
    type: DnsRecordType,
    content: string,
) {
    const key = groupKey(type, name)
    const group = into.get(key) ?? { name, type, contents: new Set<string>() }
    group.contents.add(content)
    into.set(key, group)
}

/**
 * the record set zeronsd would serve for this network, expressed as porkbun
 * records under <subdomain>.<domain> (zeronsd/src/authority.rs:583-651).
 */
export function buildDesiredRecords(
    members: NetworkMember[],
    {
        domain,
        subdomain,
        wildcard,
    }: { domain: string; subdomain: string; wildcard: boolean },
): DesiredRecords {
    const desired: DesiredRecords = new Map()
    const claimedBy = new Map<string, Set<string>>()

    for (const member of members) {
        if (!member.config.authorized) {
            continue
        }
        if (member.config.ipAssignments.length == 0) {
            continue
        }

        const hosts = [`zt-${member.nodeId}`]
        if (member.name != null) {
            const host = toHostname(member.name)
            if (host == null) {
                console.warn(
                    `member ${member.nodeId}: name ${JSON.stringify(member.name)} is not usable as a dns name, skipping its custom record`,
                )
            } else {
                hosts.push(host)
            }
        }
        // wildcards are independent records pointing at the same addresses
        const names = wildcard
            ? hosts.flatMap((h) => [h, toWildcard(h)])
            : hosts

        for (const host of names) {
            const name = `${host}.${subdomain}`
            if (!fitsDnsName(name, domain)) {
                console.warn(
                    `member ${member.nodeId}: ${name}.${domain} is too long, skipping`,
                )
                continue
            }
            for (const ip of member.config.ipAssignments) {
                const version = isIP(ip)
                if (version == 0) {
                    console.warn(
                        `member ${member.nodeId}: bad ip ${ip}, skipping`,
                    )
                    continue
                }
                const type = version == 4 ? "A" : "AAAA"
                addContent(desired, name, type, ip)

                const key = groupKey(type, name)
                const claimants = claimedBy.get(key) ?? new Set<string>()
                claimants.add(member.nodeId)
                claimedBy.set(key, claimants)
            }
        }
    }

    for (const [key, claimants] of claimedBy) {
        if (1 < claimants.size) {
            console.warn(
                `collision: ${key} is claimed by ${[...claimants].join(", ")}; publishing the union of their addresses`,
            )
        }
    }

    return desired
}

/**
 * the bare name of a record we own, or null when it is outside the managed
 * subdomain or not an address record.
 */
function managedName(
    record: DnsRecord,
    domain: string,
    subdomain: string,
): string | null {
    if (record.type != "A" && record.type != "AAAA") {
        return null
    }
    const suffix = `.${domain}`
    const name = record.name.toLowerCase()
    if (!name.endsWith(suffix)) {
        return null
    }
    const bare = name.slice(0, -suffix.length)
    if (bare != subdomain && !bare.endsWith(`.${subdomain}`)) {
        return null
    }
    return bare
}

/** what to create, edit and delete so porkbun matches `desired` */
export function planChanges(
    desired: DesiredRecords,
    live: DnsRecord[],
    {
        domain,
        subdomain,
        ttl,
    }: { domain: string; subdomain: string; ttl: number },
): RecordPlan {
    const plan: RecordPlan = {
        creates: [],
        edits: [],
        deletes: [],
        managedCount: 0,
    }

    const liveByKey = new Map<
        string,
        { name: string; type: DnsRecordType; records: DnsRecord[] }
    >()
    for (const record of live) {
        const name = managedName(record, domain, subdomain)
        if (name == null) {
            continue
        }
        if (record.type != "A" && record.type != "AAAA") {
            continue
        }
        plan.managedCount += 1
        const key = groupKey(record.type, name)
        const group = liveByKey.get(key) ?? {
            name,
            type: record.type,
            records: [],
        }
        group.records.push(record)
        liveByKey.set(key, group)
    }

    for (const key of new Set([...desired.keys(), ...liveByKey.keys()])) {
        const group = desired.get(key) ?? liveByKey.get(key)
        if (group == null) {
            continue
        }
        const { name, type } = group
        const wanted = new Set(desired.get(key)?.contents ?? [])
        const existing = liveByKey.get(key)?.records ?? []

        const stale: DnsRecord[] = []
        for (const record of existing) {
            if (!wanted.delete(record.content)) {
                stale.push(record)
                continue
            }
            if (record.ttl != ttl) {
                plan.edits.push({
                    id: record.id,
                    name,
                    type,
                    content: record.content,
                })
            }
        }

        // reuse a record that has to change anyway rather than deleting and
        // recreating it, so the name never resolves to nothing in between
        const missing = [...wanted]
        const reused = Math.min(stale.length, missing.length)
        for (let i = 0; i < reused; i += 1) {
            const record = stale[i]
            const content = missing[i]
            if (record == null || content == null) {
                continue
            }
            plan.edits.push({ id: record.id, name, type, content })
        }
        for (const content of missing.slice(reused)) {
            plan.creates.push({ name, type, content })
        }
        plan.deletes.push(...stale.slice(reused))
    }

    return plan
}

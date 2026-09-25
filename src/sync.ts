import { config } from "./config.ts"
import type { DnsRecord, PorkbunAuth } from "./pb.ts"
import {
    createRecord,
    deleteRecord,
    editRecord,
    ping,
    PorkbunError,
    retrieveRecords,
} from "./pb.ts"
import { buildDesiredRecords, planChanges } from "./records.ts"
import { getNetworkMembers } from "./zt.ts"

const MAX_RATE_LIMIT_WAIT_SECONDS = 300

export const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms))

const auth: PorkbunAuth = {
    apiKey: config.porkbunApiKey,
    secretApiKey: config.porkbunSecretApiKey,
    useIpv4Endpoint: config.useIpv4Endpoint,
}

const zone = {
    domain: config.porkbunDomain,
    subdomain: config.porkbunSubdomain,
}

/** fail fast on bad credentials instead of on the first sync */
export async function preflight() {
    const res = await ping(auth)
    console.log(
        `porkbun credentials ok, api sees us as ${res.yourIp ?? "unknown"}`,
    )
}

/**
 * one write, with the porkbun failures that are worth surviving handled.
 * returns null when the call did not happen; throws to abandon the tick.
 */
async function write<T>(label: string, call: () => Promise<T>) {
    const run = async () => {
        const result = await call()
        console.log(label)
        return result
    }
    try {
        return await run()
    } catch (e) {
        if (!(e instanceof PorkbunError)) {
            throw e
        }
        switch (e.code) {
            case "RATE_LIMIT_EXCEEDED": {
                const wait = Math.min(
                    e.retryAfterSeconds ?? 30,
                    MAX_RATE_LIMIT_WAIT_SECONDS,
                )
                console.warn(`rate limited, retrying ${label} in ${wait}s`)
                await sleep(wait * 1000)
                // a second failure gives up on the whole tick
                return await run()
            }
            case "DUPLICATE_RECORD":
                console.warn(
                    `${label}: already exists as ${e.existingId ?? "?"}, adopting it`,
                )
                return null
            case "RECORD_CONFLICT":
                console.error(
                    `${label}: blocked by another record, clear it by hand: ${JSON.stringify(e.conflictingRecords)}`,
                )
                return null
            case "ZONE_RECORD_LIMIT":
                throw e
            default:
                console.error(`${label}: ${e.message}`)
                return null
        }
    }
}

interface Operation {
    label: string
    run: () => Promise<unknown>
}

const deleteOperations = (records: DnsRecord[]): Operation[] =>
    records.map((r) => ({
        label: `delete ${r.type} ${r.name} ${r.content}`,
        run: () => deleteRecord({ domain: zone.domain, id: r.id }, auth),
    }))

/** report the round, then carry it out unless this is a dry run */
async function apply(summary: string, operations: Operation[]) {
    if (config.dryRun) {
        console.log(`[dry run] ${summary}`)
        for (const operation of operations) {
            console.log(`[dry run] ${operation.label}`)
        }
        return
    }

    console.log(summary)
    for (const operation of operations) {
        // eslint-disable-next-line no-await-in-loop
        await write(operation.label, operation.run)
    }
}

/**
 * delete every record we own and stop. the prune ratio guard does not apply,
 * because removing all of them is the point.
 */
export async function wipe() {
    const live = await retrieveRecords({ domain: zone.domain }, auth)
    const plan = planChanges(new Map(), live, {
        ...zone,
        ttl: config.recordTtl,
    })
    const summary = `wiping ${String(plan.managedCount)} records under ${zone.subdomain}.${zone.domain}`
    await apply(summary, deleteOperations(plan.deletes))
}

/** converge porkbun onto what the network looks like right now */
export async function syncOnce() {
    const members = await getNetworkMembers({
        networkId: config.zerotierNetworkId,
        token: config.zerotierToken,
    })
    const desired = buildDesiredRecords(members, {
        ...zone,
        wildcard: config.wildcard,
    })
    if (desired.size == 0) {
        console.error(
            "no authorized members with addresses; skipping this round rather than emptying the zone",
        )
        return
    }

    const live = await retrieveRecords({ domain: zone.domain }, auth)
    const plan = planChanges(desired, live, { ...zone, ttl: config.recordTtl })

    let { deletes } = plan
    const pruneRatio =
        plan.managedCount == 0 ? 0 : deletes.length / plan.managedCount
    if (config.maxPruneRatio < pruneRatio) {
        console.error(
            `refusing to delete ${String(deletes.length)} of ${String(plan.managedCount)} managed records, over PORKBUN_MAX_PRUNE_RATIO`,
        )
        deletes = []
    }

    const summary = `${String(plan.creates.length)} to create, ${String(plan.edits.length)} to edit, ${String(deletes.length)} to delete, ${String(plan.managedCount)} managed`

    // one list, so a dry run reports exactly what a real run will do
    // additions first, so a rename never leaves the name unresolvable
    await apply(summary, [
        ...plan.creates.map((r) => ({
            label: `create ${r.type} ${r.name} ${r.content}`,
            run: () =>
                createRecord(
                    { ...r, domain: zone.domain, ttl: config.recordTtl },
                    auth,
                ),
        })),
        ...plan.edits.map((r) => ({
            label: `edit ${r.type} ${r.name} ${r.content}`,
            run: () =>
                editRecord(
                    { ...r, domain: zone.domain, ttl: config.recordTtl },
                    auth,
                ),
        })),
        ...deleteOperations(deletes),
    ])
}

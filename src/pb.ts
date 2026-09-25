import * as z from "zod"

export interface PorkbunAuth {
    apiKey: string
    secretApiKey: string
    useIpv4Endpoint: boolean
}

export type DnsRecordType = "A" | "AAAA"

const pbApi = (path: string, useIpv4Endpoint: boolean) =>
    new URL(
        path,
        useIpv4Endpoint
            ? "https://api-ipv4.porkbun.com/api/json/v3/"
            : "https://api.porkbun.com/api/json/v3/",
    )

const errorSchema = z.object({
    status: z.literal("ERROR"),
    message: z.string(),
    code: z.string().nullish(),
    // returned with DUPLICATE_RECORD, so the existing record can be adopted
    existingId: z.string().nullish(),
    // returned with RECORD_CONFLICT; shape is not pinned down in the spec
    conflictingRecords: z.unknown().nullish(),
    // seconds until the rate limit resets
    ttlRemaining: z.number().nullish(),
})

const warningsSchema = z.object({ warnings: z.array(z.string()).nullish() })

export class PorkbunError extends Error {
    code: string | null
    existingId: string | null
    conflictingRecords: unknown
    retryAfterSeconds: number | null

    constructor(
        message: string,
        details: {
            code?: string | null | undefined
            existingId?: string | null | undefined
            conflictingRecords?: unknown
            retryAfterSeconds?: number | null | undefined
        } = {},
    ) {
        super(message)
        this.name = "PorkbunError"
        this.code = details.code ?? null
        this.existingId = details.existingId ?? null
        this.conflictingRecords = details.conflictingRecords
        this.retryAfterSeconds = details.retryAfterSeconds ?? null
    }
}

function retryAfterFrom(res: Response, ttlRemaining: number | null) {
    const header = res.headers.get("retry-after")
    if (header != null && header.trim() != "") {
        const seconds = Number(header)
        if (!Number.isNaN(seconds)) {
            return seconds
        }
    }
    return ttlRemaining
}

/**
 * every porkbun endpoint is a POST whose body carries the credentials; the
 * header form only applies when body credentials are absent.
 */
async function post<T>(
    path: string,
    body: Record<string, unknown>,
    schema: z.ZodType<T>,
    auth: PorkbunAuth,
): Promise<T> {
    const res = await fetch(pbApi(path, auth.useIpv4Endpoint), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            apikey: auth.apiKey,
            secretapikey: auth.secretApiKey,
            ...body,
        }),
    })
    const json: unknown = await res.json().catch(() => null)

    const err = errorSchema.safeParse(json)
    if (err.success) {
        throw new PorkbunError(err.data.message, {
            code: err.data.code,
            existingId: err.data.existingId,
            conflictingRecords: err.data.conflictingRecords,
            retryAfterSeconds: retryAfterFrom(
                res,
                err.data.ttlRemaining ?? null,
            ),
        })
    }
    if (!res.ok) {
        throw new PorkbunError(`${path}: HTTP ${String(res.status)}`, {
            retryAfterSeconds: retryAfterFrom(res, null),
        })
    }

    // non-fatal, but includes "this domain is not on porkbun's nameservers",
    // which means the write landed and still resolves nothing
    const warned = warningsSchema.safeParse(json)
    if (warned.success) {
        for (const warning of warned.data.warnings ?? []) {
            console.warn(`porkbun ${path}: ${warning}`)
        }
    }

    return schema.parse(json)
}

const pingSchema = z.object({
    status: z.literal("SUCCESS"),
    yourIp: z.string().nullish(),
})

export async function ping(auth: PorkbunAuth) {
    return post("ping", {}, pingSchema, auth)
}

const dnsRecordSchema = z.object({
    id: z.string(),
    // fully qualified on read, unlike the bare subdomain writes take
    name: z.string(),
    type: z.string(),
    content: z.string(),
    ttl: z.coerce.number().int(),
    prio: z.coerce.number().int().nullish(),
    notes: z.string().nullish(),
})
export type DnsRecord = z.infer<typeof dnsRecordSchema>

const retrieveSchema = z.object({
    status: z.literal("SUCCESS"),
    records: z.array(dnsRecordSchema),
})

export async function retrieveRecords(
    { domain }: { domain: string },
    auth: PorkbunAuth,
) {
    const res = await post(`dns/retrieve/${domain}`, {}, retrieveSchema, auth)
    return res.records
}

const createSchema = z.object({
    status: z.literal("SUCCESS"),
    id: z.string(),
})

export async function createRecord(
    {
        domain,
        ...record
    }: {
        domain: string
        name: string
        type: DnsRecordType
        content: string
        ttl: number
    },
    auth: PorkbunAuth,
) {
    return post(`dns/create/${domain}`, record, createSchema, auth)
}

const basicSchema = z.object({
    status: z.literal("SUCCESS"),
    message: z.string().nullish(),
})

export async function editRecord(
    {
        domain,
        id,
        ...record
    }: {
        domain: string
        id: string
        name: string
        type: DnsRecordType
        content: string
        ttl: number
    },
    auth: PorkbunAuth,
) {
    return post(`dns/edit/${domain}/${id}`, record, basicSchema, auth)
}

export async function deleteRecord(
    { domain, id }: { domain: string; id: string },
    auth: PorkbunAuth,
) {
    return post(`dns/delete/${domain}/${id}`, {}, basicSchema, auth)
}

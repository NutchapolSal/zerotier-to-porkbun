import { readFileSync } from "node:fs"
import * as z from "zod"

const dnsName = z.string().trim().toLowerCase().min(1)

const envRes = z
    .object({
        ZEROTIER_TOKEN: z.string().nullish(),
        ZEROTIER_TOKEN_FILE: z.string().nullish(),
        ZEROTIER_NETWORK_ID: z.string(),

        PORKBUN_API_KEY: z.string().nullish(),
        PORKBUN_API_KEY_FILE: z.string().nullish(),
        PORKBUN_SECRET_API_KEY: z.string().nullish(),
        PORKBUN_SECRET_API_KEY_FILE: z.string().nullish(),

        // the registrable domain the records live in, eg. example.com
        PORKBUN_DOMAIN: dnsName,
        // the prefix this script wholly owns, eg. zt -> zt.example.com
        PORKBUN_SUBDOMAIN: dnsName.refine(
            (s) => !s.startsWith(".") && !s.endsWith("."),
            "must not start or end with a dot",
        ),

        PORKBUN_RECORD_TTL: z.coerce.number().int().min(600).default(600),
        PORKBUN_WILDCARD: z.stringbool().default(true),
        PORKBUN_USE_IPV4_ENDPOINT: z.stringbool().default(false),
        PORKBUN_MAX_PRUNE_RATIO: z.coerce.number().min(0).max(1).default(0.5),
        PORKBUN_DRY_RUN: z.stringbool().default(false),

        SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(300),
        SYNC_ONCE: z.stringbool().default(false),
        // delete every record we manage, then exit; skips zerotier entirely
        SYNC_WIPE: z.stringbool().default(false),
    })
    .safeParse(process.env)
if (!envRes.success) {
    console.error("Invalid environment variables:")
    console.error(z.prettifyError(envRes.error))
    process.exit(1)
}
const env = envRes.data

/**
 * accepts either NAME or NAME_FILE (for docker secrets), never both.
 * process.exit is typed never, so this always narrows to string.
 */
function resolveSecret(
    name: string,
    value: string | null | undefined,
    file: string | null | undefined,
): string {
    if (value != null && file != null) {
        console.error(`only one of ${name} or ${name}_FILE may be set`)
        process.exit(1)
    }
    if (value != null) {
        return value
    }
    if (file == null) {
        console.error(`one of ${name} or ${name}_FILE must be set`)
        process.exit(1)
    }
    try {
        return readFileSync(file, "utf8").trim()
    } catch (e) {
        console.error(`failed to read ${name}_FILE (${file}):`, e)
        process.exit(1)
    }
}

export const config = {
    zerotierToken: resolveSecret(
        "ZEROTIER_TOKEN",
        env.ZEROTIER_TOKEN,
        env.ZEROTIER_TOKEN_FILE,
    ),
    zerotierNetworkId: env.ZEROTIER_NETWORK_ID,
    porkbunApiKey: resolveSecret(
        "PORKBUN_API_KEY",
        env.PORKBUN_API_KEY,
        env.PORKBUN_API_KEY_FILE,
    ),
    porkbunSecretApiKey: resolveSecret(
        "PORKBUN_SECRET_API_KEY",
        env.PORKBUN_SECRET_API_KEY,
        env.PORKBUN_SECRET_API_KEY_FILE,
    ),
    porkbunDomain: env.PORKBUN_DOMAIN,
    porkbunSubdomain: env.PORKBUN_SUBDOMAIN,
    recordTtl: env.PORKBUN_RECORD_TTL,
    useIpv4Endpoint: env.PORKBUN_USE_IPV4_ENDPOINT,
    wildcard: env.PORKBUN_WILDCARD,
    maxPruneRatio: env.PORKBUN_MAX_PRUNE_RATIO,
    dryRun: env.PORKBUN_DRY_RUN,
    syncIntervalSeconds: env.SYNC_INTERVAL_SECONDS,
    syncOnce: env.SYNC_ONCE,
    wipe: env.SYNC_WIPE,
}

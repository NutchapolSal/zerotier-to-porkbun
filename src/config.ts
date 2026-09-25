import * as z from "zod/v4"

const configRes = z
    .object({
        ZEROTIER_TOKEN: z.string().nullish(),
        ZEROTIER_TOKEN_FILE: z.string().nullish(),
        ZEROTIER_NETWORK_ID: z.string(),
    })
    .safeParse(process.env)
// TODO: add transform for validating either token or file was passed in
if (!configRes.success) {
    console.error("Invalid environment variables:")
    console.error(z.prettifyError(configRes.error))
    process.exit()
}
export const config = configRes.data

import * as z from "zod"

const ztApi = (path: string) =>
    new URL(path, "https://api.zerotier.com/api/v1/")

const networkSchema = z.object({
    config: z.object({
        name: z.string(),
        dns: z.object({
            domain: z.string(),
        }),
    }),
})

export async function getNetwork({
    networkId,
    token,
}: {
    networkId: string
    token: string
}) {
    const res = await fetch(ztApi(`network/${networkId}`), {
        headers: {
            Authorization: `token ${token}`,
        },
    })
    return networkSchema.parse(await res.json())
}

const networkMemberSchema = z.object({
    nodeId: z.string(),
    name: z
        .string()
        .nullish()
        .transform((v) => (v == "" ? null : v)),
    description: z.string(),
    config: z.object({
        authorized: z.boolean(),
        ipAssignments: z.array(z.string()),
    }),
    lastSeen: z.number(),
    physicalAddress: z.string().nullish(),
})
const networkMembersSchema = z.array(networkMemberSchema)

export async function getNetworkMembers({
    networkId,
    token,
}: {
    networkId: string
    token: string
}) {
    const res = await fetch(ztApi(`network/${networkId}/member`), {
        headers: {
            Authorization: `token ${token}`,
        },
    })
    return networkMembersSchema.parse(await res.json())
}

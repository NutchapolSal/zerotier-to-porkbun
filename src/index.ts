import { config } from "./config.ts"
import { getNetwork, getNetworkMembers } from "./zt.ts"

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
while (true) {
    // TODO
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 1000 * 60 * 10))
}

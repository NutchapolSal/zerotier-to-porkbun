import { config } from "./config.ts"
import { preflight, sleep, syncOnce, wipe } from "./sync.ts"

try {
    await preflight()
} catch (e) {
    console.error("porkbun preflight failed:", e)
    process.exit(1)
}

if (config.wipe) {
    try {
        await wipe()
    } catch (e) {
        console.error("wipe failed:", e)
        process.exit(1)
    }
} else {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
        try {
            // eslint-disable-next-line no-await-in-loop
            await syncOnce()
        } catch (e) {
            // one bad round should not take the process down
            console.error("sync failed:", e)
        }
        if (config.syncOnce) {
            break
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(config.syncIntervalSeconds * 1000)
    }
}

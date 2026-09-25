const MAX_LABEL_LENGTH = 63
const MAX_NAME_LENGTH = 253

// ported from zeronsd's ToHostname (zeronsd/src/traits.rs:43-99)
const translationTable = [
    [/\s+/gu, "-"], // translate whitespace to `-`
    [/[^.\s\w\d-]+/gu, ""], // catch-all at the end
] as const

/**
 * turns a zerotier member name into a dns name, or null when it cannot be
 * represented. callers warn and fall back to the zt-<nodeId> name, the same
 * way zeronsd's parse_member_name does (zeronsd/src/utils.rs:134-149).
 *
 * two deliberate differences from zeronsd:
 * - we lowercase. zeronsd keeps the original case and leans on trust-dns'
 *   case-insensitive name equality; we diff plain strings against porkbun.
 * - rust's `\w` is unicode-aware, javascript's is ascii-only, so non-ascii
 *   names get stripped harder here. porkbun would want punycode anyway.
 */
export function toHostname(input: string): string | null {
    let s = input.trim()
    for (const [pattern, replacement] of translationTable) {
        s = s.replace(pattern, replacement)
    }
    s = s.trim().toLowerCase()

    if (s == "" || s == "." || s.endsWith(".")) {
        return null
    }
    // stands in for trust-dns' Name parsing
    const labels = s.split(".")
    const badLabel = (label: string) =>
        label == "" || MAX_LABEL_LENGTH < label.length
    if (labels.some(badLabel)) {
        return null
    }
    return s
}

/** `*.<host>`, as zeronsd's wildcard mode emits (traits.rs:36-41) */
export function toWildcard(host: string): string {
    return `*.${host}`
}

/** whether `<name>.<zone>` still fits in a dns name */
export function fitsDnsName(name: string, zone: string): boolean {
    return name.length + 1 + zone.length <= MAX_NAME_LENGTH
}

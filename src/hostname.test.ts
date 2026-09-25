import assert from "node:assert/strict"
import test from "node:test"
import { fitsDnsName, toHostname, toWildcard } from "./hostname.ts"

// cases ported from zeronsd's test_parse_member_name
// (zeronsd/src/tests.rs:10-55). zeronsd compares case-insensitive dns
// names, so its "unchanged" cases are our lowercased ones.
void test("keeps names that are already dns compatible", () => {
    assert.equal(toHostname("islay"), "islay")
    assert.equal(toHostname("ALL-CAPS"), "all-caps")
    assert.equal(toHostname("Capitalized"), "capitalized")
    assert.equal(toHostname("with.dots"), "with.dots")
})

void test("translates names that need it", () => {
    assert.equal(toHostname("Erik's laptop"), "eriks-laptop")
    assert.equal(toHostname("!foo"), "foo")
    assert.equal(toHostname("  spaced   out  "), "spaced-out")
    assert.equal(toHostname("under_score"), "under_score")
})

void test("rejects names it cannot represent", () => {
    assert.equal(toHostname("."), null)
    assert.equal(toHostname("!"), null)
    assert.equal(toHostname("arghle."), null)
    assert.equal(toHostname(""), null)
    assert.equal(toHostname("   "), null)
    assert.equal(toHostname(".leading"), null)
    assert.equal(toHostname("double..dot"), null)
    assert.equal(toHostname("a".repeat(64)), null)
    assert.equal(toHostname("a".repeat(63)), "a".repeat(63))
})

void test("wildcards prefix the whole name", () => {
    assert.equal(toWildcard("zt-abc123.zt"), "*.zt-abc123.zt")
})

void test("name budget accounts for the zone", () => {
    assert.equal(fitsDnsName("host.zt", "example.com"), true)
    assert.equal(fitsDnsName("a".repeat(250), "example.com"), false)
})

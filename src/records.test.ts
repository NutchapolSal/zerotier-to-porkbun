import assert from "node:assert/strict"
import test from "node:test"
import type { DnsRecord } from "./pb.ts"
import { buildDesiredRecords, planChanges } from "./records.ts"

const zone = { domain: "example.com", subdomain: "zt" }

const member = (
    nodeId: string,
    name: string | null,
    ipAssignments: string[],
    authorized = true,
) => ({
    nodeId,
    name,
    description: "",
    config: { authorized, ipAssignments },
    lastSeen: 0,
    physicalAddress: null,
})

const record = (
    id: string,
    name: string,
    type: string,
    content: string,
    ttl = 600,
): DnsRecord => ({ id, name, type, content, ttl, prio: null, notes: null })

const flatten = (desired: ReturnType<typeof buildDesiredRecords>) =>
    [...desired.values()]
        .flatMap((g) => [...g.contents].map((c) => `${g.type} ${g.name} ${c}`))
        .sort()

void test("emits zt- and custom names for both address families", () => {
    const desired = buildDesiredRecords(
        [member("abc1234567", "Erik's laptop", ["10.0.0.1", "fd00::1"])],
        { ...zone, wildcard: false },
    )
    assert.deepEqual(flatten(desired), [
        "A eriks-laptop.zt 10.0.0.1",
        "A zt-abc1234567.zt 10.0.0.1",
        "AAAA eriks-laptop.zt fd00::1",
        "AAAA zt-abc1234567.zt fd00::1",
    ])
})

void test("wildcard mode adds independent star records", () => {
    const desired = buildDesiredRecords(
        [member("abc1234567", null, ["10.0.0.1"])],
        { ...zone, wildcard: true },
    )
    assert.deepEqual(flatten(desired), [
        "A *.zt-abc1234567.zt 10.0.0.1",
        "A zt-abc1234567.zt 10.0.0.1",
    ])
})

void test("skips unauthorized members and members without addresses", () => {
    const desired = buildDesiredRecords(
        [
            member("abc1234567", null, ["10.0.0.1"], false),
            member("def1234567", null, []),
        ],
        { ...zone, wildcard: false },
    )
    assert.deepEqual(flatten(desired), [])
})

void test("creates what is missing and prunes what we no longer want", () => {
    const desired = buildDesiredRecords(
        [member("abc1234567", null, ["10.0.0.1"])],
        { ...zone, wildcard: false },
    )
    const plan = planChanges(
        desired,
        [
            record("1", "zt-old0000000.zt.example.com", "A", "10.0.0.9"),
            record("2", "www.example.com", "A", "10.0.0.8"),
            record("3", "zt-abc1234567.zt.example.com", "TXT", "hello"),
        ],
        { ...zone, ttl: 600 },
    )
    assert.deepEqual(plan.creates, [
        { name: "zt-abc1234567.zt", type: "A", content: "10.0.0.1" },
    ])
    assert.deepEqual(
        plan.deletes.map((r) => r.id),
        ["1"],
    )
    assert.equal(plan.edits.length, 0)
    // the TXT record and anything outside the subdomain are not ours
    assert.equal(plan.managedCount, 1)
})

void test("a changed address reuses the record instead of churning it", () => {
    const desired = buildDesiredRecords(
        [member("abc1234567", null, ["10.0.0.2"])],
        { ...zone, wildcard: false },
    )
    const plan = planChanges(
        desired,
        [record("7", "zt-abc1234567.zt.example.com", "A", "10.0.0.1")],
        { ...zone, ttl: 600 },
    )
    assert.deepEqual(plan.edits, [
        { id: "7", name: "zt-abc1234567.zt", type: "A", content: "10.0.0.2" },
    ])
    assert.equal(plan.creates.length, 0)
    assert.equal(plan.deletes.length, 0)
})

void test("losing an address deletes just that record", () => {
    const desired = buildDesiredRecords(
        [member("abc1234567", null, ["10.0.0.1"])],
        { ...zone, wildcard: false },
    )
    const plan = planChanges(
        desired,
        [
            record("7", "zt-abc1234567.zt.example.com", "A", "10.0.0.1"),
            record("8", "zt-abc1234567.zt.example.com", "A", "10.0.0.2"),
        ],
        { ...zone, ttl: 600 },
    )
    assert.deepEqual(
        plan.deletes.map((r) => r.id),
        ["8"],
    )
    assert.equal(plan.creates.length, 0)
    assert.equal(plan.edits.length, 0)
})

void test("ttl drift is corrected in place", () => {
    const desired = buildDesiredRecords(
        [member("abc1234567", null, ["10.0.0.1"])],
        { ...zone, wildcard: false },
    )
    const plan = planChanges(
        desired,
        [record("7", "zt-abc1234567.zt.example.com", "A", "10.0.0.1", 60)],
        { ...zone, ttl: 600 },
    )
    assert.deepEqual(plan.edits, [
        { id: "7", name: "zt-abc1234567.zt", type: "A", content: "10.0.0.1" },
    ])
})

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANON_NS,
  hashAccount,
  namespaceFor,
  projectsKeyFor,
  draftKeyFor,
  mergeProjectsById,
  planNamespaceTransition,
} from "../src/lib/project-namespace.mjs";

test("namespaceFor: signed out / empty → anon, signed in → stable per-account", () => {
  assert.equal(namespaceFor(null), ANON_NS);
  assert.equal(namespaceFor(undefined), ANON_NS);
  assert.equal(namespaceFor(""), ANON_NS);
  assert.equal(namespaceFor("   "), ANON_NS);
  const a = namespaceFor("alice@example.com");
  assert.equal(a, namespaceFor("alice@example.com")); // deterministic
  assert.notEqual(a, ANON_NS);
});

test("hashAccount is case/whitespace-insensitive and distinct per identity", () => {
  assert.equal(hashAccount("Alice@Example.com"), hashAccount("  alice@example.com "));
  assert.notEqual(hashAccount("alice@example.com"), hashAccount("bob@example.com"));
});

test("two different accounts get different project buckets (the leak fix)", () => {
  const aliceKey = projectsKeyFor(namespaceFor("alice@example.com"));
  const bobKey = projectsKeyFor(namespaceFor("bob@example.com"));
  const anonKey = projectsKeyFor(ANON_NS);
  assert.notEqual(aliceKey, bobKey);
  assert.notEqual(aliceKey, anonKey);
  assert.notEqual(bobKey, anonKey);
});

test("key builders are namespaced and never collide with the legacy base key", () => {
  assert.equal(projectsKeyFor(ANON_NS), "conclave_wf_projects:anon");
  assert.equal(draftKeyFor(ANON_NS), "conclave_wf_draft:anon");
  // legacy bare keys ("conclave_wf_projects") have no ":ns" suffix, so
  // getItem on the base never returns a namespaced bucket
  assert.notEqual(projectsKeyFor(ANON_NS), "conclave_wf_projects");
});

test("mergeProjectsById: incoming wins and stays first, dedup by id, existing appended", () => {
  const existing = [{ id: "a", n: 1 }, { id: "b", n: 1 }];
  const incoming = [{ id: "b", n: 2 }, { id: "c", n: 2 }];
  const merged = mergeProjectsById(existing, incoming);
  assert.deepEqual(merged.map((p) => p.id), ["b", "c", "a"]);
  assert.equal(merged.find((p) => p.id === "b").n, 2); // incoming won
});

test("mergeProjectsById ignores malformed entries", () => {
  const merged = mergeProjectsById([{ id: "a" }, null, { nope: 1 }], [undefined, { id: "b" }]);
  assert.deepEqual(merged.map((p) => p.id), ["b", "a"]);
});

test("planNamespaceTransition: anon → account claims the anon bucket", () => {
  const { nextNs, claimAnon } = planNamespaceTransition(ANON_NS, "alice@example.com");
  assert.equal(nextNs, namespaceFor("alice@example.com"));
  assert.equal(claimAnon, true);
});

test("planNamespaceTransition: account → different account switches, no claim", () => {
  const aliceNs = namespaceFor("alice@example.com");
  const { nextNs, claimAnon } = planNamespaceTransition(aliceNs, "bob@example.com");
  assert.equal(nextNs, namespaceFor("bob@example.com"));
  assert.equal(claimAnon, false); // Bob must NOT inherit anon/Alice projects
});

test("planNamespaceTransition: sign-out → anon, no claim", () => {
  const aliceNs = namespaceFor("alice@example.com");
  const { nextNs, claimAnon } = planNamespaceTransition(aliceNs, null);
  assert.equal(nextNs, ANON_NS);
  assert.equal(claimAnon, false);
});

test("planNamespaceTransition: same account re-reconcile is a no-op (no re-claim)", () => {
  const aliceNs = namespaceFor("alice@example.com");
  const { nextNs, claimAnon } = planNamespaceTransition(aliceNs, "alice@example.com");
  assert.equal(nextNs, aliceNs);
  assert.equal(claimAnon, false);
});

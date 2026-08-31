import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  GitHubTransport,
  ReleaseSafetyError,
  SecurityBlockError,
  assertAllowedChanges,
  assertCompatibleCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
  gitBlobSha,
  gitTreeSha,
  isReleasePath,
  selectReleaseChanges,
  verifyCommit,
  type ReleaseCheckpoint,
} from "./release-core";

const checkpoint: ReleaseCheckpoint = {
  version: 1,
  repository: "o/r",
  branch: "main",
  localHead: "local",
  baseCommit: "base",
  baseTree: "tree",
  manifestDigest: "digest",
  blobs: {},
};

describe("release safety", () => {
  it("ignores known workspace-only files but rejects unknown or generated release files", () => {
    expect(() => assertAllowedChanges([
      { status: "M", path: "artifacts/api-server/src/index.ts" },
      { status: "A", path: "attached_assets/private.pdf" },
      { status: "A", path: "exports/report.docx" },
      { status: "A", path: "artifacts/api-server/dist/index.mjs" },
    ])).toThrow(/explicit source allowlist/);
    expect(isReleasePath("artifacts/api-server/dist/index.mjs")).toBe(false);
    expect(isReleasePath("artifacts/api-server/.env")).toBe(false);
    expect(isReleasePath("artifacts/api-server/src/server.ts")).toBe(true);
    expect(isReleasePath("lib/db/migrations/0001_safe.sql")).toBe(true);
    expect(isReleasePath(".github/workflows/deploy.yml")).toBe(false);
    expect(isReleasePath(".github/workflows/unreviewed.yml")).toBe(false);
    expect(selectReleaseChanges([
      { status: "M", path: "package.json" },
      { status: "M", path: ".github/workflows/deploy.yml" },
      { status: "M", path: ".agents/memory/MEMORY.md" },
      { status: "A", path: "attached_assets/reference.png" },
      { status: "M", path: ".replit" },
    ])).toEqual([{ status: "M", path: "package.json" }]);
    expect(() => selectReleaseChanges([
      { status: "M", path: "package.json" },
      { status: "A", path: "notes.txt" },
    ])).toThrow(/explicit source allowlist/);
  });

  it("atomically persists and reloads partial success without credentials", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "release-test-"));
    const file = path.join(dir, "state.json");
    const partial = { ...checkpoint, blobs: { "package.json": { gitSha: "blob", contentSha256: "hash", mode: "100644" as const } } };
    await saveCheckpoint(file, partial);
    expect(await loadCheckpoint(file)).toEqual(partial);
    expect(await readFile(file, "utf8")).not.toMatch(/token|authorization/i);
  });

  it("rejects stale checkpoints and branch drift", () => {
    expect(() => assertCompatibleCheckpoint(checkpoint, { ...checkpoint, localHead: "other" }, "base"))
      .toThrow(/incompatible/);
    expect(() => assertCompatibleCheckpoint(checkpoint, checkpoint, "someone-else"))
      .toThrow(/drifted/);
  });
});

describe("GitHubTransport", () => {
  it("opens its circuit on a Cloudflare HTML block and never retries writes", async () => {
    const fetch = vi.fn(async () => new Response(
      "<!doctype html><title>Attention Required! | Cloudflare</title><p>Sorry, you have been blocked</p>",
      { status: 403, headers: { "content-type": "text/html" } },
    ));
    const transport = new GitHubTransport({ fetch, spacingMs: 0 });
    await expect(transport.write("/blobs", { method: "POST", body: "{}" }, { stage: "blob", file: "a.ts" }))
      .rejects.toBeInstanceOf(SecurityBlockError);
    await expect(transport.write("/blobs", { method: "POST", body: "{}" }, { stage: "blob", file: "b.ts" }))
      .rejects.toBeInstanceOf(SecurityBlockError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([403, 429, 503])("fails closed for write status %s even without HTML", async (status) => {
    const fetch = vi.fn(async () => new Response('{"message":"blocked"}', {
      status,
      headers: { "content-type": "application/json" },
    }));
    const transport = new GitHubTransport({ fetch, spacingMs: 0 });
    await expect(transport.write("/blobs", { method: "POST", body: "{}" }, { stage: "blob" }))
      .rejects.toBeInstanceOf(SecurityBlockError);
  });

  it("reconciles an ambiguous non-idempotent write instead of repeating it", async () => {
    const fetch = vi.fn(async () => { throw new Error("connection reset"); });
    const reconcile = vi.fn(async () => ({ sha: "already-created" }));
    const transport = new GitHubTransport({ fetch, spacingMs: 0 });
    await expect(transport.write("/commits", { method: "POST", body: "{}" }, { stage: "commit", reconcile }))
      .resolves.toEqual({ sha: "already-created" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});

describe("final verification", () => {
  it("derives the content-addressed recursive tree SHA for reconciliation", () => {
    const readme = gitBlobSha(Buffer.from("hello\n"));
    expect(gitTreeSha([{ path: "README.md", mode: "100644", type: "blob", sha: readme }]))
      .toBe("853694aae8816094a0d875fee7ea26278dbf5d0f");
  });
  it("checks parent, recursive tree, modes, deletions, and blob hashes", () => {
    const tree = [{ path: "package.json", mode: "100644", type: "blob", sha: "blob" }];
    expect(() => verifyCommit({
      commitSha: "commit",
      commit: { sha: "commit", tree: { sha: "tree" }, parents: [{ sha: "base" }] },
      expectedParent: "base",
      expectedTreeSha: "tree",
      remoteTree: tree,
      intendedTree: tree,
      expectedContentHashes: new Map([["package.json", "blob"]]),
    })).not.toThrow();
    expect(() => verifyCommit({
      commitSha: "commit",
      commit: { sha: "commit", tree: { sha: "tree" }, parents: [{ sha: "wrong" }] },
      expectedParent: "base",
      expectedTreeSha: "tree",
      remoteTree: tree,
      intendedTree: tree,
      expectedContentHashes: new Map(),
    })).toThrow(ReleaseSafetyError);
  });
  it("fully verifies an unchanged remote commit without requiring it to parent itself", () => {
    const tree = [{ path: "package.json", mode: "100644", type: "blob", sha: "blob" }];
    expect(() => verifyCommit({
      commitSha: "current-head",
      commit: { sha: "current-head", tree: { sha: "tree" }, parents: [{ sha: "previous-head" }] },
      expectedTreeSha: "tree",
      remoteTree: tree,
      intendedTree: tree,
      expectedContentHashes: new Map(),
    })).not.toThrow();
    expect(() => verifyCommit({
      commitSha: "current-head",
      commit: { sha: "different-head", tree: { sha: "tree" }, parents: [{ sha: "previous-head" }] },
      expectedTreeSha: "tree",
      remoteTree: tree,
      intendedTree: tree,
      expectedContentHashes: new Map(),
    })).toThrow(ReleaseSafetyError);
  });
});
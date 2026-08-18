// One-step release: push the current source to the GitHub deployment
// repository and wait until the GitHub Actions deploy to Azure succeeds.
//
//   pnpm release                  — normal release (requires a version bump)
//   pnpm release --allow-same-version
//
// The GitHub repository (see CONFIG) builds the app from source in its
// deploy workflow (.github/workflows/deploy.yml) and pushes the assembled
// package to Azure App Service. This script therefore syncs SOURCE files.
//
// Authentication goes through the Replit GitHub connector proxy
// (@replit/connectors-sdk); no tokens are stored in this project. Note that
// plain `git push` does NOT work with the connector — the Git Data API via
// the proxy is the supported path.

import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  pollForRunCompletion,
  DeploymentFailedError,
  DeploymentTimeoutError,
  type ActionsRun,
} from "./release-poll";

// ─── Config ──────────────────────────────────────────────────────────────────
const OWNER = "Sahotagarry";
const REPO = "loancalculator";
const BRANCH = "main";
// Paths never created, modified, or deleted by a release (owned by the IT
// admin / CI, not by this workspace).
const PROTECTED_PREFIXES = [".github/"];
// ─────────────────────────────────────────────────────────────────────────────

const API = "https://api.github.com";
const proxyFetch = new ReplitConnectors().createProxyFetch("github");

function git(args: string[], opts: { cwd: string }): string {
  return execFileSync("git", args, { cwd: opts.cwd, encoding: "utf-8" }).trim();
}

async function gh<T>(pathOrUrl: string, init?: RequestInit): Promise<T> {
  const res = await proxyFetch(`${API}${pathOrUrl}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${init?.method ?? "GET"} ${pathOrUrl} failed (${res.status}): ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

/** gh() with retry on 429 (the connector proxy rate-limits ~10 req/s). */
async function ghRetry<T>(pathOrUrl: string, init?: RequestInit): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await gh<T>(pathOrUrl, init);
    } catch (err) {
      const msg = (err as Error).message;
      if (attempt < 5 && (msg.includes("(429)") || msg.includes("Rate limit"))) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

async function main() {
  const allowSameVersion = process.argv.includes("--allow-same-version");
  const root = git(["rev-parse", "--show-toplevel"], { cwd: process.cwd() });

  // 1. Guard: refuse to release uncommitted source changes.
  const dirty = git(["status", "--porcelain"], { cwd: root })
    .split("\n")
    .filter(Boolean)
    .filter((line) => {
      const p = line.slice(3);
      return !(
        p.includes("node_modules/") ||
        /(^|\/)dist\//.test(p) ||
        p.endsWith(".tsbuildinfo")
      );
    });
  if (dirty.length > 0) {
    console.error("Refusing to release: there are uncommitted source changes:");
    for (const line of dirty) console.error(`  ${line}`);
    console.error("Commit (checkpoint) your work first, then run the release again.");
    process.exit(1);
  }

  const headSha = git(["rev-parse", "HEAD"], { cwd: root });

  // 2. Where is the deployment repository right now?
  const ref = await gh<{ object: { sha: string } }>(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  const remoteSha = ref.object.sha;
  const remoteCommit = await gh<{ tree: { sha: string } }>(`/repos/${OWNER}/${REPO}/git/commits/${remoteSha}`);

  // Make sure the remote commit is known locally so git can diff against it.
  try {
    git(["cat-file", "-e", `${remoteSha}^{commit}`], { cwd: root });
  } catch {
    try {
      git(["fetch", "origin", BRANCH], { cwd: root });
      git(["cat-file", "-e", `${remoteSha}^{commit}`], { cwd: root });
    } catch {
      console.error(
        `The deployment repository is at commit ${remoteSha}, which this workspace doesn't know about.\n` +
          `Someone may have pushed to ${OWNER}/${REPO} outside this workspace. Ask the agent to re-sync GitHub first.`,
      );
      process.exit(1);
    }
  }

  // 3. Version guard: a release should be identifiable by its version.
  const localVersion = JSON.parse(await readFile(path.join(root, "package.json"), "utf-8")).version;
  let remoteVersion: string | undefined;
  try {
    remoteVersion = JSON.parse(git(["show", `${remoteSha}:package.json`], { cwd: root })).version;
  } catch {
    remoteVersion = undefined;
  }
  if (!allowSameVersion && remoteVersion !== undefined && localVersion === remoteVersion) {
    console.error(
      `The app version (${localVersion}) is unchanged from what is already deployed.\n` +
        `Bump "version" in the root package.json (and commit) so the release is identifiable in the header and at /api/version,\n` +
        `or re-run with --allow-same-version.`,
    );
    process.exit(1);
  }

  // 4. What changed?
  const diff = git(["diff", "--no-renames", "--name-status", remoteSha, "HEAD"], { cwd: root })
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status: status as "A" | "M" | "D", path: rest.join("\t") };
    });

  const protectedTouched = diff.filter((e) => PROTECTED_PREFIXES.some((pre) => e.path.startsWith(pre)));
  const entries = diff.filter((e) => !PROTECTED_PREFIXES.some((pre) => e.path.startsWith(pre)));
  if (protectedTouched.length > 0) {
    console.log(
      `Skipping ${protectedTouched.length} protected path(s) (${PROTECTED_PREFIXES.join(", ")}) — these belong to the deployment repo:`,
    );
    for (const e of protectedTouched) console.log(`  ${e.status} ${e.path}`);
  }
  if (entries.length === 0) {
    console.log("Nothing to release — the deployment repository already matches this source.");
    return;
  }

  console.log(`Releasing v${localVersion}: ${entries.length} file(s) to sync to ${OWNER}/${REPO}@${BRANCH}.`);

  // 5. Upload blobs (batches of 10).
  const treeEntries: Array<{ path: string; mode: string; type: "blob"; sha: string | null }> = [];
  const upserts = entries.filter((e) => e.status !== "D");
  for (let i = 0; i < upserts.length; i += 5) {
    const batch = upserts.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (e) => {
        const abs = path.join(root, e.path);
        const [buf, st] = await Promise.all([readFile(abs), stat(abs)]);
        const blob = await ghRetry<{ sha: string }>(`/repos/${OWNER}/${REPO}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: buf.toString("base64"), encoding: "base64" }),
        });
        return {
          path: e.path,
          mode: st.mode & 0o111 ? "100755" : "100644",
          type: "blob" as const,
          sha: blob.sha,
        };
      }),
    );
    treeEntries.push(...results);
    console.log(`Uploaded ${Math.min(i + 10, upserts.length)}/${upserts.length} files…`);
  }
  for (const e of entries.filter((x) => x.status === "D")) {
    treeEntries.push({ path: e.path, mode: "100644", type: "blob", sha: null });
  }

  // 6. Create the tree + commit and move the branch.
  const message = git(["log", "-1", "--format=%s"], { cwd: root });
  const tree = await gh<{ sha: string }>(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: remoteCommit.tree.sha, tree: treeEntries }),
  });
  const commit = await gh<{ sha: string }>(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message: `v${localVersion}: ${message}`, tree: tree.sha, parents: [remoteSha] }),
  });
  await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  console.log(`Pushed commit ${commit.sha}`);
  console.log(`Actions: https://github.com/${OWNER}/${REPO}/actions`);

  // 7. Wait for the Azure deployment to finish.
  const run = await pollForRunCompletion({
    headSha: commit.sha,
    fetchRuns: async (sha): Promise<ActionsRun[]> => {
      const data = await gh<{ workflow_runs: ActionsRun[] }>(
        `/repos/${OWNER}/${REPO}/actions/runs?head_sha=${sha}`,
      );
      return data.workflow_runs;
    },
    log: (msg) => console.log(msg),
  });
  console.log(`Deployment succeeded: ${run.html_url}`);
  console.log(`Version v${localVersion} is now live (check /api/version on the Azure site).`);

  // 8. Reconcile local git so the next release diffs cleanly.
  try {
    git(["fetch", "origin", BRANCH], { cwd: root });
    const localTree = git(["rev-parse", "HEAD^{tree}"], { cwd: root });
    const remoteTree = git(["rev-parse", `origin/${BRANCH}^{tree}`], { cwd: root });
    if (localTree === remoteTree) {
      git(
        [
          "-c", "user.name=Release Script",
          "-c", "user.email=release@local",
          "merge", "-s", "ours", `origin/${BRANCH}`, "-m",
          `Record GitHub release v${localVersion} (identical content)`,
        ],
        { cwd: root },
      );
    }
  } catch (err) {
    console.warn(`Note: could not reconcile local git history (${(err as Error).message}). This does not affect the deployment.`);
  }
}

main().catch((err) => {
  if (err instanceof DeploymentFailedError || err instanceof DeploymentTimeoutError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});

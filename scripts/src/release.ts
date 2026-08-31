// Hardened one-step release. Writes are sequential, checkpointed, and never
// blindly retried. Authentication remains inside the Replit GitHub connector.
import { execFileSync } from "node:child_process";
import { readFile, lstat, rm } from "node:fs/promises";
import path from "node:path";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  GitHubTransport,
  ReleaseSafetyError,
  SecurityBlockError,
  assertAllowedChanges,
  assertCompatibleCheckpoint,
  gitBlobSha,
  gitTreeSha,
  isReleasePath,
  loadCheckpoint,
  manifestDigest,
  saveCheckpoint,
  selectReleaseChanges,
  sha256,
  verifyCommit,
  type DiffEntry,
  type ManifestEntry,
  type ReleaseCheckpoint,
  type RemoteTreeEntry,
} from "./release-core";
import {
  pollForRunCompletion,
  DeploymentFailedError,
  DeploymentTimeoutError,
  type ActionsRun,
} from "./release-poll";

const OWNER = "Sahotagarry";
const REPO = "loancalculator";
const BRANCH = "main";
const REPOSITORY = `${OWNER}/${REPO}`;
const DEPLOY_WORKFLOW_PATH = ".github/workflows/deploy.yml";
const API = "https://api.github.com";
const WRITE_SPACING_MS = parsePositiveInteger(process.env.RELEASE_WRITE_SPACING_MS, 2_000);
const proxyFetch = new ReplitConnectors().createProxyFetch("github");

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ReleaseSafetyError("RELEASE_WRITE_SPACING_MS must be a non-negative integer.");
  }
  return parsed;
}

function git(args: string[], root: string): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function parseDiff(raw: string): DiffEntry[] {
  return raw.split("\n").filter(Boolean).map((line) => {
    const [status, ...rest] = line.split("\t");
    if (!["A", "M", "D"].includes(status)) {
      throw new ReleaseSafetyError(`Unsupported git change status ${status}; renames must be represented as delete/add.`);
    }
    return { status: status as DiffEntry["status"], path: rest.join("\t") };
  });
}

async function main(): Promise<void> {
  const allowSameVersion = process.argv.includes("--allow-same-version");
  const root = git(["rev-parse", "--show-toplevel"], process.cwd());
  const checkpointPath = path.resolve(root, git(["rev-parse", "--git-dir"], root), "replit-release", `${BRANCH}.json`);
  const transport = new GitHubTransport({
    fetch: proxyFetch,
    apiBase: API,
    spacingMs: WRITE_SPACING_MS,
    log: console.log,
  });

  const dirty = git(["status", "--porcelain"], root).split("\n").filter(Boolean).filter((line) => {
    const file = line.slice(3);
    return !file.includes("node_modules/") && !/(^|\/)dist\//.test(file) && !file.endsWith(".tsbuildinfo");
  });
  if (dirty.length) {
    throw new ReleaseSafetyError(
      `Refusing to release uncommitted source changes:\n${dirty.map((line) => `  ${line}`).join("\n")}`,
    );
  }

  const localHead = git(["rev-parse", "HEAD"], root);
  const remoteRef = await transport.read<{ object: { sha: string } }>(
    `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`,
  );
  const remoteHead = remoteRef.object.sha;
  const saved = await loadCheckpoint(checkpointPath);
  const baseCommit = saved?.baseCommit ?? remoteHead;
  await ensureCommitKnown(root, baseCommit);

  const base = await transport.read<{ sha: string; tree: { sha: string } }>(
    `/repos/${OWNER}/${REPO}/git/commits/${baseCommit}`,
  );
  const allChanges = parseDiff(git(["diff", "--no-renames", "--name-status", baseCommit, "HEAD"], root));
  const diff = selectReleaseChanges(allChanges);
  const ignoredCount = allChanges.length - diff.length;
  if (ignoredCount) console.log(`Ignoring ${ignoredCount} committed workspace-only file change(s).`);
  for (const entry of diff.filter((item) => item.status === "D")) {
    if (!git(["log", "--all", "--max-count=1", "--format=%H", "--", entry.path], root)) {
      throw new ReleaseSafetyError(`Refusing to delete ${entry.path}: it has never been tracked in this workspace.`);
    }
  }

  const prepared = await prepareManifest(root, diff);
  const digest = manifestDigest(prepared);
  const expectedCheckpoint = {
    repository: REPOSITORY,
    branch: BRANCH,
    localHead,
    baseCommit,
    baseTree: base.tree.sha,
    manifestDigest: digest,
  };
  let checkpoint: ReleaseCheckpoint = saved ?? {
    version: 1,
    ...expectedCheckpoint,
    blobs: {},
  };
  if (saved) assertCompatibleCheckpoint(saved, expectedCheckpoint, remoteHead);

  const localVersion = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version as string;
  const remoteVersion = readRemoteVersion(root, baseCommit);
  if (!allowSameVersion && diff.length && remoteVersion === localVersion) {
    throw new ReleaseSafetyError(
      `The app version (${localVersion}) is unchanged. Bump package.json or use --allow-same-version.`,
    );
  }

  if (!diff.length && !checkpoint.commitSha) {
    console.log("The deployment repository already matches the releasable source.");
    checkpoint.commitSha = remoteHead;
    checkpoint.refUpdated = true;
  }

  const uploaded: ManifestEntry[] = [];
  for (const entry of prepared) {
    if (entry.sha === null) {
      uploaded.push(entry);
      continue;
    }
    const complete = checkpoint.blobs[entry.path];
    if (complete) {
      if (complete.contentSha256 !== entry.contentSha256 || complete.mode !== entry.mode) {
        throw new ReleaseSafetyError(`Checkpoint blob metadata is stale for ${entry.path}.`);
      }
      uploaded.push({ ...entry, sha: complete.gitSha });
      continue;
    }
    const content = await readFile(path.join(root, entry.path));
    const expectedGitSha = gitBlobSha(content);
    const blob = await transport.write<{ sha: string }>(
      `/repos/${OWNER}/${REPO}/git/blobs`,
      { method: "POST", body: JSON.stringify({ content: content.toString("base64"), encoding: "base64" }) },
      {
        stage: "blob",
        file: entry.path,
        reconcile: async () => {
          try {
            return await transport.read<{ sha: string }>(`/repos/${OWNER}/${REPO}/git/blobs/${expectedGitSha}`);
          } catch {
            return undefined;
          }
        },
      },
    );
    if (blob.sha !== expectedGitSha) throw new ReleaseSafetyError(`GitHub returned an unexpected blob hash for ${entry.path}.`);
    checkpoint.blobs[entry.path] = { gitSha: blob.sha, contentSha256: entry.contentSha256!, mode: entry.mode };
    await saveCheckpoint(checkpointPath, checkpoint);
    uploaded.push({ ...entry, sha: blob.sha });
  }

  const baseTree = await readRecursiveTree(transport, base.tree.sha);
  const intendedTree = applyChanges(baseTree, uploaded);
  const expectedTreeSha = gitTreeSha(intendedTree);
  if (!checkpoint.treeSha && diff.length) {
    const tree = await transport.write<{ sha: string }>(
      `/repos/${OWNER}/${REPO}/git/trees`,
      {
        method: "POST",
        body: JSON.stringify({
          base_tree: base.tree.sha,
          tree: uploaded.map(({ path: file, mode, sha }) => ({
            path: file,
            mode,
            type: "blob",
            sha,
          })),
        }),
      },
      {
        stage: "tree",
        reconcile: async () => {
          try {
            return await transport.read<{ sha: string }>(`/repos/${OWNER}/${REPO}/git/trees/${expectedTreeSha}`);
          } catch {
            return undefined;
          }
        },
      },
    );
    if (tree.sha !== expectedTreeSha) throw new ReleaseSafetyError("GitHub returned an unexpected tree hash.");
    checkpoint.treeSha = tree.sha;
    await saveCheckpoint(checkpointPath, checkpoint);
  }

  if (!checkpoint.commitSha && diff.length) {
    const message = git(["log", "-1", "--format=%s"], root);
    const commit = await transport.write<{ sha: string }>(
      `/repos/${OWNER}/${REPO}/git/commits`,
      {
        method: "POST",
        body: JSON.stringify({
          message: `v${localVersion}: ${message}`,
          tree: checkpoint.treeSha,
          parents: [baseCommit],
        }),
      },
      {
        stage: "commit",
        reconcile: async () => {
          const head = await transport.read<{ object: { sha: string } }>(
            `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`,
          );
          const candidate = await transport.read<{ sha: string; tree: { sha: string }; parents: Array<{ sha: string }> }>(
            `/repos/${OWNER}/${REPO}/git/commits/${head.object.sha}`,
          );
          return candidate.tree.sha === checkpoint.treeSha && candidate.parents[0]?.sha === baseCommit
            ? { sha: candidate.sha }
            : undefined;
        },
      },
    );
    checkpoint.commitSha = commit.sha;
    await saveCheckpoint(checkpointPath, checkpoint);
  }

  if (!checkpoint.refUpdated && checkpoint.commitSha) {
    await transport.write(
      `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`,
      { method: "PATCH", body: JSON.stringify({ sha: checkpoint.commitSha, force: false }) },
      {
        stage: "branch",
        reconcile: async () => {
          const head = await transport.read<{ object: { sha: string } }>(
            `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`,
          );
          return head.object.sha === checkpoint.commitSha ? {} : undefined;
        },
      },
    );
    checkpoint.refUpdated = true;
    await saveCheckpoint(checkpointPath, checkpoint);
  }

  if (!checkpoint.commitSha) throw new ReleaseSafetyError("No release commit is available.");
  const currentRef = await transport.read<{ object: { sha: string } }>(
    `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`,
  );
  if (currentRef.object.sha !== checkpoint.commitSha) {
    throw new ReleaseSafetyError("Remote branch moved before final verification; release association is unsafe.");
  }
  const finalCommit = await transport.read<{
    sha: string; tree: { sha: string }; parents: Array<{ sha: string }>;
  }>(`/repos/${OWNER}/${REPO}/git/commits/${checkpoint.commitSha}`);
  const finalTree = await readRecursiveTree(transport, finalCommit.tree.sha);
  verifyCommit({
    commitSha: checkpoint.commitSha,
    commit: finalCommit,
    expectedParent: diff.length ? baseCommit : undefined,
    expectedTreeSha: checkpoint.treeSha ?? base.tree.sha,
    remoteTree: finalTree,
    intendedTree,
    expectedContentHashes: new Map(uploaded.filter((entry) => entry.sha).map((entry) => [entry.path, entry.sha!])),
  });
  checkpoint.verified = true;
  await saveCheckpoint(checkpointPath, checkpoint);

  const fetchDeployRuns = async (sha: string): Promise<ActionsRun[]> => {
    const data = await transport.read<{ workflow_runs: ActionsRun[] }>(
      `/repos/${OWNER}/${REPO}/actions/workflows/${encodeURIComponent(DEPLOY_WORKFLOW_PATH)}/runs?head_sha=${sha}`,
    );
    return data.workflow_runs.filter((run) =>
      run.path === DEPLOY_WORKFLOW_PATH && run.head_sha === sha && run.event === "push",
    );
  };
  if (!checkpoint.workflowRunId) {
    const runs = await fetchDeployRuns(checkpoint.commitSha);
    if (runs.length > 1) throw new ReleaseSafetyError("Multiple deployment runs exist for the verified commit.");
    if (runs[0]) {
      checkpoint.workflowRunId = runs[0].id;
      await saveCheckpoint(checkpointPath, checkpoint);
    }
  }
  const run = await pollForRunCompletion({
    headSha: checkpoint.commitSha,
    expectedRunId: checkpoint.workflowRunId,
    fetchRuns: async (sha) => {
      const runs = await fetchDeployRuns(sha);
      if (!checkpoint.workflowRunId && runs.length === 1) {
        checkpoint.workflowRunId = runs[0].id;
        await saveCheckpoint(checkpointPath, checkpoint);
      }
      return runs;
    },
    log: console.log,
  });
  if (checkpoint.workflowRunId !== run.id) throw new ReleaseSafetyError("Deployment completed for an unexpected workflow run.");
  console.log(`Verified commit ${checkpoint.commitSha} deployed successfully: ${run.html_url}`);
  await rm(checkpointPath, { force: true });
  reconcileLocalHistory(root, localVersion);
}

async function prepareManifest(root: string, diff: DiffEntry[]): Promise<ManifestEntry[]> {
  const result: ManifestEntry[] = [];
  for (const entry of diff) {
    if (entry.status === "D") {
      result.push({ path: entry.path, mode: "100644", sha: null });
      continue;
    }
    const absolute = path.join(root, entry.path);
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new ReleaseSafetyError(`Only regular files may be released: ${entry.path}`);
    const content = await readFile(absolute);
    result.push({
      path: entry.path,
      mode: stat.mode & 0o111 ? "100755" : "100644",
      sha: gitBlobSha(content),
      contentSha256: sha256(content),
    });
  }
  return result;
}

async function readRecursiveTree(transport: GitHubTransport, sha: string): Promise<RemoteTreeEntry[]> {
  const response = await transport.read<{ truncated?: boolean; tree: RemoteTreeEntry[] }>(
    `/repos/${OWNER}/${REPO}/git/trees/${sha}?recursive=1`,
  );
  if (response.truncated) throw new ReleaseSafetyError("GitHub truncated the recursive tree; exact release verification is impossible.");
  return response.tree.filter((entry) => entry.type === "blob");
}

function applyChanges(base: RemoteTreeEntry[], changes: ManifestEntry[]): RemoteTreeEntry[] {
  const tree = new Map(base.map((entry) => [entry.path, entry]));
  for (const entry of changes) {
    if (entry.sha === null) tree.delete(entry.path);
    else tree.set(entry.path, { path: entry.path, mode: entry.mode, type: "blob", sha: entry.sha });
  }
  return [...tree.values()];
}

async function ensureCommitKnown(root: string, sha: string): Promise<void> {
  try {
    git(["cat-file", "-e", `${sha}^{commit}`], root);
  } catch {
    git(["fetch", "origin", BRANCH], root);
    try {
      git(["cat-file", "-e", `${sha}^{commit}`], root);
    } catch {
      throw new ReleaseSafetyError(`Remote commit ${sha} is not known locally; re-sync GitHub before releasing.`);
    }
  }
}

function readRemoteVersion(root: string, sha: string): string | undefined {
  try {
    return (JSON.parse(git(["show", `${sha}:package.json`], root)) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

function reconcileLocalHistory(root: string, version: string): void {
  try {
    git(["fetch", "origin", BRANCH], root);
    const releasableDiff = git(["diff", "--name-only", "HEAD", `origin/${BRANCH}`], root)
      .split("\n")
      .filter(Boolean)
      .filter(isReleasePath);
    if (releasableDiff.length || isRemoteAncestor(root)) return;
    execFileSync("git", [
      "-c", "user.name=Release Script",
      "-c", "user.email=release@local",
      "merge", "-s", "ours", `origin/${BRANCH}`, "-m", `Record GitHub release v${version} (identical releasable content)`,
    ], { cwd: root });
  } catch (error) {
    console.warn(`Local history reconciliation was skipped: ${(error as Error).message}`);
  }
}

function isRemoteAncestor(root: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", `origin/${BRANCH}`, "HEAD"], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  if (
    error instanceof DeploymentFailedError ||
    error instanceof DeploymentTimeoutError ||
    error instanceof SecurityBlockError ||
    error instanceof ReleaseSafetyError
  ) console.error(error.message);
  else console.error(error);
  process.exitCode = 1;
});
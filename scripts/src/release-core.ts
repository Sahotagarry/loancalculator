import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const CHECKPOINT_VERSION = 1;
export const RELEASE_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  ".npmrc",
  "DEPLOYMENT.md",
] as const;

export interface DiffEntry {
  status: "A" | "M" | "D";
  path: string;
}

export interface ManifestEntry {
  path: string;
  mode: "100644" | "100755";
  sha: string | null;
  contentSha256?: string;
}

export interface ReleaseCheckpoint {
  version: 1;
  repository: string;
  branch: string;
  localHead: string;
  baseCommit: string;
  baseTree: string;
  manifestDigest: string;
  blobs: Record<string, { gitSha: string; contentSha256: string; mode: "100644" | "100755" }>;
  treeSha?: string;
  commitSha?: string;
  refUpdated?: boolean;
  verified?: boolean;
  workflowRunId?: number;
}

export class SecurityBlockError extends Error {
  constructor(public readonly stage: string, public readonly file?: string) {
    super(
      `Release stopped by a Replit/Cloudflare security block during ${stage}${file ? ` (${file})` : ""}. ` +
        "Do not retry; wait for the security cooldown before starting a new release attempt.",
    );
    this.name = "SecurityBlockError";
  }
}

export class ReleaseSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseSafetyError";
  }
}

export function isReleasePath(file: string): boolean {
  if (file.includes("\\") || file.startsWith("/") || file.split("/").includes("..")) return false;
  if (
    /(^|\/)(node_modules|dist|build|coverage|exports?|screenshots?|attached_assets|\.replit-artifact)(\/|$)/.test(file) ||
    /(^|\/)\.(env|git|agents?)(\.|\/|$)/.test(file) ||
    /\.(log|tmp|tsbuildinfo|docx|pdf|xlsx|zip)$/i.test(file)
  ) return false;
  if (RELEASE_FILES.includes(file as (typeof RELEASE_FILES)[number])) return true;
  if (/^docs\/[^/]+(?:\/[^/]+)*\.md$/.test(file)) return true;
  if (/^scripts\/(?:package\.json|tsconfig\.json|src\/[^/]+(?:\/[^/]+)*\.(?:ts|mjs|json))$/.test(file)) return true;
  if (/^lib\/[^/]+\/(?:package\.json|tsconfig\.json|vitest\.config\.ts|drizzle\.config\.ts|orval\.config\.ts|openapi\.yaml|src\/[^/]+(?:\/[^/]+)*\.(?:ts|tsx|json)|migrations\/[^/]+\.sql)$/.test(file)) return true;
  return /^artifacts\/(?:api-server|loan-calculator)\/(?:package\.json|tsconfig\.json|vitest\.config\.ts|vite\.config\.ts|build\.mjs|index\.html|components\.json|vite-plugin-meta-images\.ts|public\/[^/]+(?:\/[^/]+)*\.(?:png|jpg|jpeg|svg|ico|txt|webmanifest)|src\/[^/]+(?:\/[^/]+)*\.(?:ts|tsx|css|json|png|jpg|jpeg|svg))$/.test(file);
}

export function isWorkspaceOnlyPath(file: string): boolean {
  return file === ".replit" ||
    file === "replit.md" ||
    /^\.github\//.test(file) ||
    /^\.agents\//.test(file) ||
    /^(?:attached_assets|screenshots)\//.test(file);
}

export function assertAllowedChanges(entries: DiffEntry[]): void {
  const unexpected = entries.filter((entry) => !isReleasePath(entry.path));
  if (unexpected.length) {
    throw new ReleaseSafetyError(
      "Refusing to release files outside the explicit source allowlist:\n" +
        unexpected.map((entry) => `  ${entry.status} ${entry.path}`).join("\n"),
    );
  }
}

export function selectReleaseChanges(entries: DiffEntry[]): DiffEntry[] {
  const selected = entries.filter((entry) => !isWorkspaceOnlyPath(entry.path));
  assertAllowedChanges(selected);
  return selected;
}

export function gitBlobSha(content: Buffer): string {
  return createHash("sha1")
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest("hex");
}

export function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function manifestDigest(entries: ManifestEntry[]): string {
  const normalized = [...entries]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(({ path: file, mode, sha, contentSha256 }) => ({ path: file, mode, sha, contentSha256 }));
  return sha256(Buffer.from(JSON.stringify(normalized)));
}

export function isSecurityBlock(status: number, contentType: string | null, body: string): boolean {
  const sample = body.slice(0, 4096).toLowerCase();
  return [403, 429, 503].includes(status) || (
    status === 403 && (
      sample.includes("cloudflare") ||
      sample.includes("attention required") ||
      sample.includes("sorry, you have been blocked") ||
      sample.includes("security service") ||
      sample.includes("ray id")
    )
  ) || (
    (status === 403 || status === 429 || status === 503) &&
    (contentType?.toLowerCase().includes("text/html") ?? false) &&
    (sample.includes("<html") || sample.includes("<!doctype"))
  );
}

export function gitTreeSha(entries: RemoteTreeEntry[]): string {
  type Node = { files: RemoteTreeEntry[]; children: Map<string, Node> };
  const root: Node = { files: [], children: new Map() };
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let child = node.children.get(part);
      if (!child) {
        child = { files: [], children: new Map() };
        node.children.set(part, child);
      }
      node = child;
    }
    node.files.push({ ...entry, path: parts.at(-1)! });
  }
  const hashNode = (node: Node): string => {
    const records: Array<{ name: string; mode: string; sha: string }> = [
      ...node.files.map((file) => ({ name: file.path, mode: file.mode, sha: file.sha })),
      ...[...node.children].map(([name, child]) => ({ name, mode: "40000", sha: hashNode(child) })),
    ].sort((a, b) => Buffer.compare(Buffer.from(`${a.name}${a.mode === "40000" ? "/" : ""}`), Buffer.from(`${b.name}${b.mode === "40000" ? "/" : ""}`)));
    const body = Buffer.concat(records.map((record) => Buffer.concat([
      Buffer.from(`${record.mode} ${record.name}\0`),
      Buffer.from(record.sha, "hex"),
    ])));
    return createHash("sha1").update(`tree ${body.length}\0`).update(body).digest("hex");
  };
  return hashNode(root);
}

export async function saveCheckpoint(file: string, checkpoint: ReleaseCheckpoint): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
}

export async function loadCheckpoint(file: string): Promise<ReleaseCheckpoint | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as ReleaseCheckpoint;
    if (parsed.version !== CHECKPOINT_VERSION) {
      throw new ReleaseSafetyError("The release checkpoint format is stale; remove it and restart safely.");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function assertCompatibleCheckpoint(
  checkpoint: ReleaseCheckpoint,
  expected: Pick<ReleaseCheckpoint, "repository" | "branch" | "localHead" | "baseCommit" | "baseTree" | "manifestDigest">,
  remoteHead: string,
): void {
  for (const key of ["repository", "branch", "localHead", "baseCommit", "baseTree", "manifestDigest"] as const) {
    if (checkpoint[key] !== expected[key]) {
      throw new ReleaseSafetyError(`Release checkpoint is incompatible (${key} changed); refusing unsafe resume.`);
    }
  }
  const allowedHeads = checkpoint.refUpdated && checkpoint.commitSha
    ? [checkpoint.baseCommit, checkpoint.commitSha]
    : [checkpoint.baseCommit];
  if (!allowedHeads.includes(remoteHead)) {
    throw new ReleaseSafetyError(
      `Remote branch drifted from checkpoint (${checkpoint.baseCommit} -> ${remoteHead}); refusing unsafe resume.`,
    );
  }
}

export interface GitHubTransportOptions {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  apiBase?: string;
  spacingMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export class GitHubTransport {
  private circuitOpen = false;
  private lastWriteAt = 0;
  private readonly apiBase: string;
  private readonly spacingMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (message: string) => void;

  constructor(private readonly options: GitHubTransportOptions) {
    this.apiBase = options.apiBase ?? "https://api.github.com";
    this.spacingMs = options.spacingMs ?? 2_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.log = options.log ?? (() => {});
  }

  async read<T>(apiPath: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request<T>(apiPath, undefined, "read");
      } catch (error) {
        if (error instanceof SecurityBlockError || attempt >= 4 || !isTransientReadError(error)) throw error;
        await this.sleep(1_500 * (attempt + 1));
      }
    }
  }

  async write<T>(
    apiPath: string,
    init: RequestInit,
    context: { stage: string; file?: string; reconcile?: () => Promise<T | undefined> },
  ): Promise<T> {
    if (this.circuitOpen) throw new SecurityBlockError(context.stage, context.file);
    const wait = this.spacingMs - (Date.now() - this.lastWriteAt);
    if (wait > 0) await this.sleep(wait);
    this.log(`[release:${context.stage}] ${context.file ?? "Git object"}`);
    try {
      return await this.request<T>(apiPath, init, context.stage, context.file);
    } catch (error) {
      if (error instanceof SecurityBlockError) {
        this.circuitOpen = true;
        throw error;
      }
      if (context.reconcile) {
        const reconciled = await context.reconcile();
        if (reconciled !== undefined) return reconciled;
      }
      throw error;
    } finally {
      this.lastWriteAt = Date.now();
    }
  }

  private async request<T>(
    apiPath: string,
    init: RequestInit | undefined,
    stage: string,
    file?: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.options.fetch(`${this.apiBase}${apiPath}`, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...(init?.headers ?? {}),
        },
      });
    } catch (error) {
      throw new Error(`GitHub ${stage} request failed: ${(error as Error).message}`);
    }
    if (!response.ok) {
      const body = await response.text();
      if (isSecurityBlock(response.status, response.headers.get("content-type"), body)) {
        this.circuitOpen = true;
        throw new SecurityBlockError(stage, file);
      }
      throw new Error(`GitHub ${stage} request failed (${response.status})`);
    }
    return (await response.json()) as T;
  }
}

function isTransientReadError(error: unknown): boolean {
  const message = (error as Error).message;
  return /\((429|500|502|503)\)/.test(message) || message.includes("fetch failed");
}

export interface RemoteTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

export function verifyCommit(options: {
  commitSha: string;
  commit: { sha: string; tree: { sha: string }; parents: Array<{ sha: string }> };
  expectedParent?: string;
  expectedTreeSha: string;
  remoteTree: RemoteTreeEntry[];
  intendedTree: RemoteTreeEntry[];
  expectedContentHashes: Map<string, string>;
}): void {
  const { commit, commitSha, expectedParent, expectedTreeSha } = options;
  if (commit.sha !== commitSha) {
    throw new ReleaseSafetyError("Final commit does not match the verified branch head.");
  }
  if (expectedParent !== undefined && (commit.parents.length !== 1 || commit.parents[0]?.sha !== expectedParent)) {
    throw new ReleaseSafetyError("Final commit parent does not match the intended release base.");
  }
  if (commit.tree.sha !== expectedTreeSha) {
    throw new ReleaseSafetyError("Final commit points at an unexpected tree.");
  }
  const simplify = (entries: RemoteTreeEntry[]) =>
    [...entries].sort((a, b) => a.path.localeCompare(b.path))
      .map(({ path: file, mode, type, sha }) => `${file}\0${mode}\0${type}\0${sha}`);
  if (JSON.stringify(simplify(options.remoteTree)) !== JSON.stringify(simplify(options.intendedTree))) {
    throw new ReleaseSafetyError("Final recursive tree, modes, deletions, or blob hashes differ from the intended manifest.");
  }
  for (const [file, expected] of options.expectedContentHashes) {
    const actual = options.remoteTree.find((entry) => entry.path === file);
    if (!actual || actual.sha !== expected) {
      throw new ReleaseSafetyError(`Final content hash differs for ${file}.`);
    }
  }
}
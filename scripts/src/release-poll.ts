// Polling logic for the release script, separated so it can be unit tested.
// After a release commit is pushed, we wait for the GitHub Actions deploy run
// triggered by that commit and only declare the release successful when the
// run concludes successfully.

export interface ActionsRun {
  id: number;
  status: string; // "queued" | "in_progress" | "completed"
  conclusion: string | null; // "success" | "failure" | "cancelled" | ...
  html_url: string;
  /** Workflow file path, e.g. ".github/workflows/deploy.yml" */
  path?: string;
}

export interface PollOptions {
  headSha: string;
  /** Fetches the workflow runs for the given commit SHA. */
  fetchRuns: (headSha: string) => Promise<ActionsRun[]>;
  /** Polling interval. Default 10s. */
  intervalMs?: number;
  /** Overall deadline. Default 5 minutes. */
  deadlineMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
}

export class DeploymentFailedError extends Error {
  constructor(
    public readonly conclusion: string,
    public readonly runUrl: string,
  ) {
    super(`Deployment run concluded with "${conclusion}". Details: ${runUrl}`);
    this.name = "DeploymentFailedError";
  }
}

export class DeploymentTimeoutError extends Error {
  constructor(public readonly headSha: string, deadlineMs: number) {
    super(
      `Timed out after ${Math.round(deadlineMs / 1000)}s waiting for the deployment run for ${headSha} to complete.`,
    );
    this.name = "DeploymentTimeoutError";
  }
}

/**
 * Polls until the Actions run for `headSha` completes.
 * - Resolves with the run when it concludes "success".
 * - Throws DeploymentFailedError on any other conclusion.
 * - Throws DeploymentTimeoutError if the deadline passes (including when no
 *   run ever appears).
 */
export async function pollForRunCompletion(options: PollOptions): Promise<ActionsRun> {
  const {
    headSha,
    fetchRuns,
    intervalMs = 10_000,
    deadlineMs = 300_000,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => Date.now(),
    log = () => {},
  } = options;

  const deadline = now() + deadlineMs;
  let sawRun = false;

  while (now() < deadline) {
    const runs = await fetchRuns(headSha);
    const run = runs[0];
    if (run) {
      if (!sawRun) {
        sawRun = true;
        log(`Deployment run started: ${run.html_url}`);
      }
      if (run.status === "completed") {
        if (run.conclusion === "success") {
          return run;
        }
        throw new DeploymentFailedError(run.conclusion ?? "unknown", run.html_url);
      }
      log(`Deployment ${run.status}…`);
    } else {
      log("Waiting for the deployment run to appear…");
    }
    await sleep(intervalMs);
  }

  throw new DeploymentTimeoutError(headSha, deadlineMs);
}

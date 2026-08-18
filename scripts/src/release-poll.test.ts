import { describe, it, expect } from "vitest";
import {
  pollForRunCompletion,
  DeploymentFailedError,
  DeploymentTimeoutError,
  type ActionsRun,
} from "./release-poll";

function run(status: string, conclusion: string | null = null): ActionsRun {
  return { id: 1, status, conclusion, html_url: "https://github.com/o/r/actions/runs/1" };
}

/** Builds a fake clock + sleep so tests run instantly. */
function fakeTime() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("pollForRunCompletion", () => {
  it("resolves when the run completes successfully", async () => {
    const responses: ActionsRun[][] = [
      [], // run not visible yet
      [run("queued")],
      [run("in_progress")],
      [run("completed", "success")],
    ];
    const { now, sleep } = fakeTime();
    const result = await pollForRunCompletion({
      headSha: "abc",
      fetchRuns: async () => responses.shift() ?? [run("completed", "success")],
      intervalMs: 10_000,
      deadlineMs: 300_000,
      now,
      sleep,
    });
    expect(result.conclusion).toBe("success");
  });

  it("throws DeploymentFailedError on failure with the run URL", async () => {
    const { now, sleep } = fakeTime();
    await expect(
      pollForRunCompletion({
        headSha: "abc",
        fetchRuns: async () => [run("completed", "failure")],
        now,
        sleep,
      }),
    ).rejects.toThrowError(DeploymentFailedError);
  });

  it("throws DeploymentFailedError on cancellation", async () => {
    const { now, sleep } = fakeTime();
    await expect(
      pollForRunCompletion({
        headSha: "abc",
        fetchRuns: async () => [run("completed", "cancelled")],
        now,
        sleep,
      }),
    ).rejects.toThrowError(DeploymentFailedError);
  });

  it("throws DeploymentTimeoutError when no run ever appears", async () => {
    const { now, sleep } = fakeTime();
    let calls = 0;
    await expect(
      pollForRunCompletion({
        headSha: "abc",
        fetchRuns: async () => {
          calls++;
          return [];
        },
        intervalMs: 10_000,
        deadlineMs: 60_000,
        now,
        sleep,
      }),
    ).rejects.toThrowError(DeploymentTimeoutError);
    expect(calls).toBe(6); // 60s deadline / 10s interval
  });

  it("throws DeploymentTimeoutError when the run never completes in time", async () => {
    const { now, sleep } = fakeTime();
    await expect(
      pollForRunCompletion({
        headSha: "abc",
        fetchRuns: async () => [run("in_progress")],
        intervalMs: 10_000,
        deadlineMs: 30_000,
        now,
        sleep,
      }),
    ).rejects.toThrowError(DeploymentTimeoutError);
  });
});

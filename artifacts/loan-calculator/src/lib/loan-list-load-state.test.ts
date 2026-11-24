import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LoanListLoadState } from "@/components/loan-list-load-state";

const render = (patch: Partial<Parameters<typeof LoanListLoadState>[0]> = {}) =>
  renderToStaticMarkup(createElement(LoanListLoadState, {
    loading: false, failed: false, refreshing: false, hasData: false, onRetry: () => {}, ...patch,
  }));

describe("Year-End File loan-list request states", () => {
  it("does not confuse an initial request failure with an empty file", () => {
    const html = render({ failed: true });
    expect(html).toContain('role="alert"');
    expect(html).toContain("could not be loaded");
    expect(html).toContain("not confirmation that there are no saved loans");
    expect(html).toContain("Do not recreate");
    expect(html).toContain("Retry loading loans and leases");
  });
  it("offers retry without changing records", () => {
    expect(render({ failed: true })).not.toContain('disabled=""');
    const html = render({ failed: true, refreshing: true });
    expect(html).toContain("Retrying");
    expect(html).toContain('disabled=""');
  });
  it("identifies cached data as potentially stale after a failed refresh", () => {
    const html = render({ hasData: true, failed: true });
    expect(html).toContain("could not be refreshed");
    expect(html).toContain("may be out of date");
    expect(html).not.toContain("could not be loaded");
  });
  it("shows loading, not a blank area, while the first request is pending", () => {
    expect(render({ loading: true })).toContain("Loading loans and leases");
    expect(render({ loading: true })).toContain('role="status"');
    expect(render({ hasData: true, refreshing: true })).toBe("");
  });
  it("does not insert warnings into successfully loaded lists", () => {
    expect(render()).toBe("");
    expect(render({ hasData: true })).toBe("");
  });
  it("connects query failure and retry to the page and gates the successful-empty message", () => {
    const source = readFileSync(new URL("../pages/file-detail.tsx", import.meta.url), "utf8");
    expect(source).toContain("isError: loansError");
    expect(source).toContain("failed={loansError}");
    expect(source).toContain("void refetchLoans()");
    expect(source).toContain("!loansLoading && !loansError && loans && loans.length === 0");
  });
});

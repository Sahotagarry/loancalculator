import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { describe, expect, it, vi } from "vitest";
import { PageHeader } from "../components/page-header";
import { TooltipProvider } from "../components/ui/tooltip";
import { yearEndFileSubtitle } from "./year-end-file-heading";

vi.mock("../hooks/use-auth", () => ({
  useAuth: () => ({ user: { displayName: "Preview Accountant", role: "accountant" }, isDevIdentity: false }),
  EASY_AUTH_LOGOUT_URL: "/.auth/logout",
}));
vi.mock("../components/help-dialog", () => ({
  HelpDialog: () => createElement("button", { "aria-label": "Help" }, "?"),
}));
vi.stubGlobal("__APP_VERSION__", "1.1.5");
vi.stubGlobal("__APP_BUILD_TIME__", "2026-11-23T18:00:00Z");

describe("Year-End File heading", () => {
  it.each([
    ["March 31, 2026 Audit", "Audit"],
    ["Mar 31, 2026 Audit", "Audit"],
    ["2026-03-31 — Audit", "Audit"],
    ["March 31 2026 Audit", "Audit"],
    ["FYE March 31, 2026", ""],
    ["March 31, 2026 FYE", ""],
    ["Year-End File — March 31, 2026", ""],
    ["March 31, 2026", ""],
    ["", ""],
    ["Financing review", "Financing review"],
    ["March 31, 2025 comparative", "March 31, 2025 comparative"],
  ])("shows the FYE once while preserving the reference in %s", (name, remainder) => {
    expect(yearEndFileSubtitle("2026-03-31", name)).toBe(
      `Year-End File · March 31, 2026${remainder ? ` · ${remainder}` : ""}`,
    );
  });

  it("does not change the saved name or remove date-like text within other words", () => {
    const name = "March 31, 2026 Audit";
    yearEndFileSubtitle("2026-03-31", name);
    expect(name).toBe("March 31, 2026 Audit");
    expect(yearEndFileSubtitle("2026-03-31", "Reference2026-03-31A")).toContain("Reference2026-03-31A");
  });

  it("handles missing or invalid year ends without throwing", () => {
    expect(yearEndFileSubtitle(null, "Audit")).toBe("Year-End File · Audit");
    expect(yearEndFileSubtitle("invalid", null)).toBe("Year-End File");
  });

  it("keeps identity separate from the export toolbar without hiding thresholds", () => {
    const actions = createElement("div", { className: "flex flex-wrap gap-2", "data-testid": "export-actions" },
      ...["Consolidated Lead Sheet", "Supporting Workpapers", "Word Disclosure", "PDF Disclosure", "Edit"].map(label =>
        createElement("button", { key: label, className: "rounded-md border border-white/40 px-3 h-8 text-xs" }, label)),
    );
    const html = renderToStaticMarkup(createElement(Router, { ssrPath: "/" },
      createElement(TooltipProvider, null, createElement(PageHeader, {
        title: "Example Client Ltd.",
        backHref: "/client/example",
        breadcrumb: "Clients / Year-End Files",
        subtitle: yearEndFileSubtitle("2026-03-31", "March 31, 2026 Audit"),
        actionLayout: "toolbar",
        actions,
        toolbarMeta: createElement("span", null, "Trivial: $4,000 · Materiality: $80,000"),
      })),
    ));
    expect(html).toContain('<h1 class="text-xl md:text-2xl');
    expect(html).toContain(">Example Client Ltd.</h1>");
    expect(html.match(/March 31, 2026/g)).toHaveLength(1);
    expect(html.match(/data-testid="export-actions"/g)).toHaveLength(1);
    expect(html.indexOf('data-testid="page-header-toolbar"')).toBeLessThan(html.indexOf('data-testid="export-actions"'));
    expect(html.indexOf('data-testid="text-signed-in-user"')).toBeLessThan(html.indexOf('data-testid="page-header-toolbar"'));
    expect(html).toContain("Accountant");
    expect(html).toContain("Trivial: $4,000");
    expect(html).toContain("Materiality: $80,000");
    expect(html).toContain("/.auth/logout");
  });

  it("preserves the existing inline action layout on other pages", () => {
    const html = renderToStaticMarkup(createElement(Router, { ssrPath: "/" },
      createElement(TooltipProvider, null, createElement(PageHeader, {
        title: "Clients", actions: createElement("button", null, "Add Client"),
      })),
    ));
    expect(html).toContain("Add Client");
    expect(html).not.toContain('data-testid="page-header-toolbar"');
    expect(html).toContain('<h1 class="text-lg md:text-xl');
  });
});

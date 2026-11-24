import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssessmentAdvanceButton } from "@/components/assessment-advance-button";
import { TooltipProvider } from "@/components/ui/tooltip";

const render = (reasons: string[]) => renderToStaticMarkup(createElement(TooltipProvider, null,
  createElement(AssessmentAdvanceButton, { reasons }, "Next")));

describe("disabled assessment navigation explanation", () => {
  it("keeps Next disabled but exposes its reason on a focusable hover target", () => {
    const html = render(["Enter an expected useful life greater than zero."]);
    expect(html).toContain('disabled=""');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="group"');
    expect(html).toContain("Cannot continue: Enter an expected useful life greater than zero.");
    expect(html).toContain("Next");
  });
  it("exposes every blocker to keyboard and screen-reader users", () => {
    const html = render(["Enter the lease term.", "Confirm the proposed start date."]);
    expect(html).toContain("Cannot continue: Enter the lease term. Confirm the proposed start date.");
  });
  it("leaves available Next buttons enabled without an unnecessary wrapper or extra tab stop", () => {
    const html = render([]);
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("Cannot continue:");
    expect(html).not.toContain('tabindex="0"');
    expect(html).toContain(">Next</button>");
  });
});

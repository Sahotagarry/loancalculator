import { describe, expect, it } from "vitest";
import { formatBuildTime } from "./build-time";

describe("formatBuildTime", () => {
  it("converts a winter build to Vancouver time with an AM clock", () => {
    expect(formatBuildTime("2025-01-15T18:05:09Z"))
      .toBe("Jan 15, 2025, 10:05:09 AM PST");
  });

  it("uses Vancouver daylight time and a PM clock in summer", () => {
    expect(formatBuildTime("2025-07-15T21:05:09Z"))
      .toBe("Jul 15, 2025, 2:05:09 PM PDT");
  });

  it("uses the Vancouver calendar date when UTC is already the next day", () => {
    expect(formatBuildTime("2025-01-16T03:05:09Z"))
      .toBe("Jan 15, 2025, 7:05:09 PM PST");
  });
});

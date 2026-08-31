import { describe, expect, it } from "vitest";
import { getDefaultTopicId, getTopic, searchTopics } from "./help-content";

describe("help content", () => {
  it("opens access guidance from both Settings screens", () => {
    expect(getDefaultTopicId("/settings")).toBe("access-security");
    expect(getDefaultTopicId("/settings/access")).toBe("access-security");
  });

  it("opens recovery guidance from Trash", () => {
    expect(getDefaultTopicId("/trash")).toBe("trash-recovery");
  });

  it("makes new access and recovery guidance searchable", () => {
    expect(searchTopics("quarantined client adoption").map((topic) => topic.id)).toContain("access-security");
    expect(searchTopics("permanent purge").map((topic) => topic.id)).toContain("trash-recovery");
  });

  it("keeps all related-topic references valid", () => {
    for (const topic of searchTopics("")) {
      for (const relatedId of topic.related) {
        expect(getTopic(relatedId), `${topic.id} links to ${relatedId}`).toBeDefined();
      }
    }
  });
});
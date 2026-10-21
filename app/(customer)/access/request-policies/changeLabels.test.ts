import { describe, expect, it } from "vitest";
import { changeLabel, changeValue } from "./changeLabels";

const names = (id: string) => (id === "w1" ? "Manager then owner" : undefined);

describe("policy change labels (owner feedback, 21 Oct)", () => {
  it("names fields as the form does", () => {
    expect(changeLabel("allow_for_others")).toBe("Request for others");
    expect(changeLabel("approval_workflow_id")).toBe("Approval workflow");
    expect(changeLabel("some_new_field")).toBe("Some new field");
  });
  it("shows values in words, a workflow by name, and empty as a dash", () => {
    expect(changeValue("allow_self", true, names)).toBe("Yes");
    expect(changeValue("auto_approve", false, names)).toBe("No");
    expect(changeValue("allow_for_others", "managers", names)).toBe("Managers and access managers");
    expect(changeValue("approval_workflow_id", "w1", names)).toBe("Manager then owner");
    expect(changeValue("approval_workflow_id", "gone", names)).toBe("A workflow no longer there");
    expect(changeValue("risk_threshold", "high", names)).toBe("High");
    expect(changeValue("max_duration_days", 90, names)).toBe("90");
    expect(changeValue("name", null, names)).toBe("—");
  });
});

import { describe, expect, it } from "vitest";
import type { BundleAttribute } from "@/lib/config/bundle";
import type { IdentityAttributeDefinition } from "@/lib/shared/types/agent-identity";
import { attributePlanSize, planAttributeImport, toBundleAttribute } from "./attributeBundle";

const def = (over: Partial<IdentityAttributeDefinition>): IdentityAttributeDefinition => ({
  id: "d1",
  tenantId: "t1",
  identityType: "HUMAN",
  name: "cost_centre",
  displayName: "Cost centre",
  dataType: "string",
  required: false,
  sensitive: false,
  searchable: true,
  uniqueValue: false,
  allowedValues: [],
  validationRegex: null,
  sourceMapping: null,
  active: true,
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
});
const attr = (over: Partial<BundleAttribute>): BundleAttribute => ({ ...toBundleAttribute(def({})), ...over });

describe("PLATFORM-P0-13: identity attributes in a configuration bundle", () => {
  it("adds what is missing, matched by identity type and name", () => {
    const plan = planAttributeImport([def({})], [attr({}), attr({ identityType: null }), attr({ name: "region", displayName: "Region", dataType: "enum", allowedValues: ["EU", "US"] })]);
    expect(plan.add.map((a) => `${a.identityType}:${a.name}`)).toEqual(["null:cost_centre", "HUMAN:region"]);
    expect(plan.differs).toEqual([]);
    expect(attributePlanSize(plan)).toBe(2);
  });

  it("brings the active state to the file's, and leaves a different definition as it is", () => {
    const plan = planAttributeImport(
      [def({}), def({ id: "d2", name: "badge", displayName: "Badge", active: false }), def({ id: "d3", name: "site", displayName: "Site" })],
      [attr({ active: false, sensitive: true }), attr({ name: "badge", displayName: "Badge", active: true }), attr({ name: "site", displayName: "Site" })],
    );
    expect(plan.retire).toEqual([{ id: "d1", displayName: "Cost centre" }]);
    expect(plan.activate).toEqual([{ id: "d2", displayName: "Badge" }]);
    expect(plan.differs).toEqual(["Cost centre"]);
    expect(plan.add).toEqual([]);
  });

  it("an identical file changes nothing, whatever the order of allowed values", () => {
    const here = def({ dataType: "enum", allowedValues: ["EU", "US"] });
    const plan = planAttributeImport([here], [attr({ dataType: "enum", allowedValues: ["US", "EU"] })]);
    expect(attributePlanSize(plan)).toBe(0);
    expect(plan.differs).toEqual([]);
  });

  it("refuses the whole file for an invalid or repeated definition", () => {
    expect(() => planAttributeImport([], [attr({ name: "Bad Name" })])).toThrow(/Attribute Bad Name/);
    expect(() => planAttributeImport([], [attr({ dataType: "enum", allowedValues: [] })])).toThrow(/choice list/);
    expect(() => planAttributeImport([], [attr({}), attr({})])).toThrow(/twice/);
  });
});

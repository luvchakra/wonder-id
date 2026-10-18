import type { BundleAttribute } from "@/lib/config/bundle";
import type { IdentityAttributeDefinition } from "@/lib/shared/types/agent-identity";
import { ApiError } from "@/lib/shared/types/foundation";
import { validateAttributeDefinition } from "./identityRules";

/**
 * PLATFORM-P0-13 — identity attributes in a configuration bundle. Pure (#9).
 *
 * An attribute is matched by identity type and name. Importing adds the
 * ones this organization lacks and brings each one's active state to the
 * file's. An attribute defined differently here is left as it is (a
 * definition is never edited once made, IDENTITY-P0-16), and one the file
 * does not mention is not touched.
 */

export type AttributeImportPlan = {
  add: BundleAttribute[];
  activate: { id: string; displayName: string }[];
  retire: { id: string; displayName: string }[];
  /** Defined differently here: left as it is. */
  differs: string[];
};

const keyOf = (a: { identityType: string | null; name: string }) => `${a.identityType ?? "*"}:${a.name}`;

/** An organization's definition as a bundle carries it. */
export function toBundleAttribute(d: IdentityAttributeDefinition): BundleAttribute {
  return {
    identityType: d.identityType,
    name: d.name,
    displayName: d.displayName,
    dataType: d.dataType,
    required: d.required,
    sensitive: d.sensitive,
    searchable: d.searchable,
    uniqueValue: d.uniqueValue,
    allowedValues: [...d.allowedValues],
    validationRegex: d.validationRegex,
    sourceMapping: d.sourceMapping,
    active: d.active,
  };
}

const sameDefinition = (a: BundleAttribute, b: BundleAttribute) =>
  a.displayName === b.displayName &&
  a.dataType === b.dataType &&
  a.required === b.required &&
  a.sensitive === b.sensitive &&
  a.searchable === b.searchable &&
  a.uniqueValue === b.uniqueValue &&
  a.validationRegex === b.validationRegex &&
  a.sourceMapping === b.sourceMapping &&
  [...a.allowedValues].sort().join("\u0000") === [...b.allowedValues].sort().join("\u0000");

/**
 * What importing `incoming` would change. Every incoming definition is
 * validated as a new one would be; an invalid one refuses the whole import
 * (400), so nothing is part-applied for that reason.
 */
export function planAttributeImport(current: IdentityAttributeDefinition[], incoming: BundleAttribute[]): AttributeImportPlan {
  const here = new Map(current.map((d) => [keyOf(d), d]));
  const seen = new Set<string>();
  const plan: AttributeImportPlan = { add: [], activate: [], retire: [], differs: [] };
  for (const a of incoming) {
    const key = keyOf(a);
    if (seen.has(key)) throw new ApiError(400, "VALIDATION_FAILED", `The file defines the attribute ${a.name} twice.`);
    seen.add(key);
    try {
      validateAttributeDefinition(a);
    } catch (err) {
      throw new ApiError(400, "VALIDATION_FAILED", `Attribute ${a.name}: ${err instanceof Error ? err.message : "not valid"}`);
    }
    const d = here.get(key);
    if (!d) {
      plan.add.push(a);
      continue;
    }
    if (!sameDefinition(toBundleAttribute(d), a)) plan.differs.push(d.displayName);
    if (d.active !== a.active) (a.active ? plan.activate : plan.retire).push({ id: d.id, displayName: d.displayName });
  }
  return plan;
}

export const attributePlanSize = (p: AttributeImportPlan) => p.add.length + p.activate.length + p.retire.length;

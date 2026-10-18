import "server-only";

import type { BundleAttribute } from "@/lib/config/bundle";
import { ApiError } from "@/lib/shared/types/foundation";
import { createAttributeDefinition, listAttributeDefinitions, setAttributeDefinitionActive } from "./directory";
import { planAttributeImport, toBundleAttribute, type AttributeImportPlan } from "./attributeBundle";

/**
 * PLATFORM-P0-13 — the organization's identity attributes for a
 * configuration bundle, and importing a bundle's. Each change goes through
 * the same service calls as the Identity Attributes page (validated,
 * audited, under RLS as the user).
 */

export async function listBundleAttributes(tenantId: string): Promise<BundleAttribute[]> {
  return (await listAttributeDefinitions(tenantId)).map(toBundleAttribute);
}

export async function planBundleAttributes(tenantId: string, incoming: BundleAttribute[]): Promise<AttributeImportPlan> {
  return planAttributeImport(await listAttributeDefinitions(tenantId), incoming);
}

/**
 * Applies a plan, one attribute at a time. A failure stops the import and
 * says how much was already applied (§17.5); what was applied stays, as it
 * would from the page.
 */
export async function applyAttributePlan(tenantId: string, actorId: string, plan: AttributeImportPlan): Promise<number> {
  let done = 0;
  const step = async (label: string, run: () => Promise<unknown>) => {
    try {
      await run();
      done++;
    } catch (err) {
      const why = err instanceof ApiError ? err.message : "it could not be saved";
      throw new ApiError(err instanceof ApiError ? err.status : 500, "IMPORT_STOPPED", `${label}: ${why}. ${done} attribute change(s) were applied before it stopped.`);
    }
  };
  for (const a of plan.add) {
    await step(`Adding ${a.displayName}`, async () => {
      const d = await createAttributeDefinition(tenantId, actorId, a);
      if (!a.active) await setAttributeDefinitionActive(tenantId, actorId, d.id, false);
    });
  }
  for (const a of plan.activate) await step(`Restoring ${a.displayName}`, () => setAttributeDefinitionActive(tenantId, actorId, a.id, true));
  for (const a of plan.retire) await step(`Retiring ${a.displayName}`, () => setAttributeDefinitionActive(tenantId, actorId, a.id, false));
  return done;
}

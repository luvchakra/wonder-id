import { ApiError } from "@/lib/shared/types/foundation";
import { RISK_LEVELS, type RiskLevel } from "./requestRules";

/**
 * Approval workflows (owner request 2026-10-18) — reusable, named approval
 * patterns with several levels, used by the request policies of many
 * applications. Pure (#9, #15): the shape of a workflow and how its levels
 * become an approval chain; the engine (approvals.ts) resolves people and
 * writes the steps.
 *
 * A level is decided by all its approvers or by any one of them. A level
 * may apply only from a risk upwards (for example "a security review for
 * high and critical risk"). Levels run in order; a rejection at any level
 * rejects the request.
 */

export const WORKFLOW_APPROVER_KINDS = ["manager", "managers_manager", "resource_owner", "application_owner", "person", "group", "access_managers"] as const;
export type WorkflowApproverKind = (typeof WORKFLOW_APPROVER_KINDS)[number];
export type WorkflowApprover = { kind: Exclude<WorkflowApproverKind, "person" | "group"> } | { kind: "person"; identityId: string } | { kind: "group"; groupId: string };
export type WorkflowLevel = { name: string; rule: "all" | "any"; minRisk: RiskLevel | null; approvers: WorkflowApprover[] };

export const MAX_LEVELS = 6;
export const MAX_APPROVERS_PER_LEVEL = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const APPROVER_LABEL: Record<WorkflowApproverKind, string> = {
  manager: "Manager",
  managers_manager: "Manager's manager",
  resource_owner: "Owner of what is requested",
  application_owner: "Application owner",
  person: "A named person",
  group: "A group (any member)",
  access_managers: "Access managers",
};

/** Validates a workflow's levels; returns them normalised. Throws 400 with the first problem. */
export function validateWorkflowLevels(raw: unknown): WorkflowLevel[] {
  const fail = (m: string): never => {
    throw new ApiError(400, "VALIDATION_FAILED", m);
  };
  if (!Array.isArray(raw) || raw.length === 0) fail("A workflow needs at least one level.");
  const list = raw as unknown[];
  if (list.length > MAX_LEVELS) fail(`At most ${MAX_LEVELS} levels.`);
  return list.map((l, i) => {
    const level = (l ?? {}) as Record<string, unknown>;
    const n = i + 1;
    const name = typeof level.name === "string" && level.name.trim() ? level.name.trim().slice(0, 80) : `Level ${n}`;
    const rule = level.rule === "any" ? "any" : level.rule === "all" || level.rule === undefined ? "all" : fail(`Level ${n}: all or any must approve.`);
    const minRisk = level.minRisk === null || level.minRisk === undefined || level.minRisk === "" ? null : (RISK_LEVELS as readonly unknown[]).includes(level.minRisk) ? (level.minRisk as RiskLevel) : fail(`Level ${n}: the risk is one of ${RISK_LEVELS.join(", ")}.`);
    const approvers = Array.isArray(level.approvers) ? level.approvers : [];
    if (!approvers.length) fail(`Level ${n}: choose at least one approver.`);
    if (approvers.length > MAX_APPROVERS_PER_LEVEL) fail(`Level ${n}: at most ${MAX_APPROVERS_PER_LEVEL} approvers.`);
    const seen = new Set<string>();
    const out: WorkflowApprover[] = approvers.map((a) => {
      const ap = (a ?? {}) as Record<string, unknown>;
      if (!(WORKFLOW_APPROVER_KINDS as readonly unknown[]).includes(ap.kind)) fail(`Level ${n}: an approver must be one of ${WORKFLOW_APPROVER_KINDS.join(", ")}.`);
      let value: WorkflowApprover;
      if (ap.kind === "person") {
        if (typeof ap.identityId !== "string" || !UUID_RE.test(ap.identityId)) fail(`Level ${n}: choose the person.`);
        value = { kind: "person", identityId: ap.identityId as string };
      } else if (ap.kind === "group") {
        if (typeof ap.groupId !== "string" || !UUID_RE.test(ap.groupId)) fail(`Level ${n}: choose the group.`);
        value = { kind: "group", groupId: ap.groupId as string };
      } else value = { kind: ap.kind as Exclude<WorkflowApproverKind, "person" | "group"> };
      const key = approverKey(value);
      if (seen.has(key)) fail(`Level ${n}: the same approver is listed twice.`);
      seen.add(key);
      return value;
    });
    return { name, rule, minRisk, approvers: out };
  });
}

export function approverKey(a: WorkflowApprover): string {
  return a.kind === "person" ? `person:${a.identityId}` : a.kind === "group" ? `group:${a.groupId}` : a.kind;
}

/** The people and groups a workflow names, for the service to check they are in the organization. */
export function namedReferences(levels: WorkflowLevel[]): { identityIds: string[]; groupIds: string[] } {
  const all = levels.flatMap((l) => l.approvers);
  return {
    identityIds: [...new Set(all.flatMap((a) => (a.kind === "person" ? [a.identityId] : [])))],
    groupIds: [...new Set(all.flatMap((a) => (a.kind === "group" ? [a.groupId] : [])))],
  };
}

const rank = (r: RiskLevel) => RISK_LEVELS.indexOf(r);

/** The levels that apply to a request of this risk. */
export function levelsFor(levels: WorkflowLevel[], risk: RiskLevel): WorkflowLevel[] {
  return levels.filter((l) => l.minRisk === null || rank(risk) >= rank(l.minRisk));
}

/**
 * ACCESS-P0-31: a non-human identity or an AI agent has no manager; where a
 * workflow asks a manager, the owner of what is requested approves instead.
 */
export function approversForSubject(approvers: WorkflowApprover[], identityType: string): WorkflowApprover[] {
  if (identityType === "HUMAN" || identityType === "EXTERNAL") return approvers;
  const out: WorkflowApprover[] = [];
  for (const a of approvers) {
    const mapped: WorkflowApprover = a.kind === "manager" || a.kind === "managers_manager" ? { kind: "resource_owner" } : a;
    if (!out.some((x) => approverKey(x) === approverKey(mapped))) out.push(mapped);
  }
  return out;
}

/** One line per level, for lists and the request page. */
export function describeLevels(levels: WorkflowLevel[], names: { person?: (id: string) => string | undefined; group?: (id: string) => string | undefined } = {}): string[] {
  return levels.map((l) => {
    const who = l.approvers.map((a) => (a.kind === "person" ? (names.person?.(a.identityId) ?? "a named person") : a.kind === "group" ? `${names.group?.(a.groupId) ?? "a group"} (any member)` : APPROVER_LABEL[a.kind].toLowerCase()));
    const joined = who.length > 1 ? `${who.slice(0, -1).join(", ")} ${l.rule === "any" ? "or" : "and"} ${who[who.length - 1]}` : who[0];
    return `${l.name}: ${joined}${l.minRisk ? ` (${l.minRisk} risk and above)` : ""}`;
  });
}

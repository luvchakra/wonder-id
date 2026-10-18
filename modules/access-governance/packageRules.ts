import { ApiError } from "@/lib/shared/types/foundation";
import { APPROVAL_MODES, APPROVAL_ROUTES, ON_TIMEOUT, RISK_LEVELS, type RiskLevel } from "./requestRules";

/**
 * ACCESS-P0-20 — access package rules, pure (#9): who a package is for
 * (eligibility decides discoverability and requests), how risky it is (the
 * worst of what it includes), what an assignment's state is from its work
 * items, and when it ends. The service (`packages.ts`) does the I/O.
 */

export const PACKAGE_IDENTITY_TYPES = ["HUMAN", "EXTERNAL", "MACHINE", "AI_AGENT"] as const;
export type PackageIdentityType = (typeof PACKAGE_IDENTITY_TYPES)[number];
export const CERTIFICATION_FREQUENCIES = ["none", "quarterly", "semiannual", "annual"] as const;
export const PACKAGE_STATUSES = ["draft", "active", "retired"] as const;
/** ACCESS-P0-21 (owner decision 2026-10-18): business and IT roles are kinds of package. */
export const PACKAGE_KINDS = ["package", "business_role", "it_role"] as const;
export type PackageKind = (typeof PACKAGE_KINDS)[number];

export type PackageEligibility = { eligibleIdentityTypes: string[]; eligibleDepartments: string[] };
export type EligibilitySubject = { identityType: string; department: string | null; status: string };

/** Whether a package is for this identity, and every reason it is not. */
export function checkEligibility(pkg: PackageEligibility, subject: EligibilitySubject): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (subject.status !== "active") reasons.push("The identity is not active");
  if (!pkg.eligibleIdentityTypes.includes(subject.identityType)) reasons.push(`It is for ${pkg.eligibleIdentityTypes.map(typeLabel).join(", ")} identities only`);
  if (pkg.eligibleDepartments.length) {
    // Exact (trimmed) match, the same comparison the catalog query makes, so paging and explanation agree.
    const dept = (subject.department ?? "").trim();
    if (!pkg.eligibleDepartments.some((d) => d.trim() === dept)) reasons.push(`It is for the ${pkg.eligibleDepartments.join(", ")} department${pkg.eligibleDepartments.length === 1 ? "" : "s"} only`);
  }
  return { eligible: reasons.length === 0, reasons };
}

export function typeLabel(t: string): string {
  return t === "HUMAN" ? "people" : t === "EXTERNAL" ? "external" : t === "MACHINE" ? "machine" : t === "AI_AGENT" ? "AI agent" : t.toLowerCase();
}

const rank = (r: RiskLevel) => RISK_LEVELS.indexOf(r);
/** A package is as risky as the riskiest thing it includes (low when empty). */
export function packageRisk(itemRisks: RiskLevel[]): RiskLevel {
  return itemRisks.reduce<RiskLevel>((a, b) => (rank(b) > rank(a) ? b : a), "low");
}

export type ItemStatus = "pending" | "fulfilled" | "failed" | "revoke_pending" | "revoked";
export type AssignmentStatus = "provisioning" | "active" | "partially_failed" | "expired" | "revoked";

/**
 * A live assignment's state from its items: any failure shows (partially
 * failed, never hidden); all fulfilled is active; otherwise it is still
 * provisioning. An ended assignment keeps its end state.
 */
export function assignmentStatus(current: AssignmentStatus, items: ItemStatus[]): AssignmentStatus {
  if (current === "expired" || current === "revoked") return current;
  if (items.some((s) => s === "failed")) return "partially_failed";
  if (items.length && items.every((s) => s === "fulfilled")) return "active";
  return "provisioning";
}

/** What ending an assignment does to each item: fulfilled access becomes revocation work; the rest is closed. */
export function itemOnEnd(status: ItemStatus): ItemStatus {
  return status === "fulfilled" || status === "revoke_pending" ? "revoke_pending" : "revoked";
}

/** When a new assignment ends: the requested expiry, else the package default, else never. */
export function assignmentExpiry(now: Date, requestedDays: number | null, pkg: { defaultDurationDays: number | null; maxDurationDays: number | null }): { days: number | null; expiresAt: string | null } {
  const days = requestedDays ?? pkg.defaultDurationDays ?? pkg.maxDurationDays ?? null;
  if (days !== null && pkg.maxDurationDays !== null && days > pkg.maxDurationDays) throw new ApiError(400, "DURATION_TOO_LONG", `At most ${pkg.maxDurationDays} days for this package`);
  return { days, expiresAt: days === null ? null : new Date(now.getTime() + days * 86_400_000).toISOString() };
}

export type PackageFields = Record<string, unknown>;

/** Validates a package's fields; `partial` for an update. Returns database columns. */
export function validatePackageInput(input: Record<string, unknown>, partial: boolean): PackageFields {
  const out: PackageFields = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
  const fail = (m: string): never => {
    throw new ApiError(400, "VALIDATION_FAILED", m);
  };
  const oneOf = (k: string, col: string, values: readonly string[]) => {
    if (!has(k)) return;
    if (!values.includes(input[k] as string)) fail(`${k}: one of ${values.join(", ")}`);
    out[col] = input[k];
  };
  if (!partial || has("name")) {
    const n = typeof input.name === "string" ? input.name.trim() : "";
    if (!n || n.length > 200) fail("name: 1 to 200 characters");
    out.name = n;
  }
  if (has("description")) {
    const d = input.description === null ? "" : String(input.description).trim();
    if (d.length > 2000) fail("description: at most 2000 characters");
    out.description = d || null;
  }
  if (has("requestable")) out.requestable = input.requestable === true || input.requestable === "true" || input.requestable === "on";
  if (has("extensionAllowed")) out.extension_allowed = input.extensionAllowed === true || input.extensionAllowed === "true" || input.extensionAllowed === "on";
  if (has("eligibleIdentityTypes")) {
    const types = Array.isArray(input.eligibleIdentityTypes) ? input.eligibleIdentityTypes : [];
    if (!types.length || types.some((t) => !(PACKAGE_IDENTITY_TYPES as readonly unknown[]).includes(t))) fail(`eligibleIdentityTypes: one or more of ${PACKAGE_IDENTITY_TYPES.join(", ")}`);
    out.eligible_identity_types = [...new Set(types as string[])];
  }
  if (has("eligibleDepartments")) {
    const raw = Array.isArray(input.eligibleDepartments) ? input.eligibleDepartments : typeof input.eligibleDepartments === "string" ? input.eligibleDepartments.split(",") : [];
    const depts = [...new Set(raw.map((d) => String(d).trim()).filter(Boolean))];
    if (depts.length > 50 || depts.some((d) => d.length > 100)) fail("eligibleDepartments: at most 50 names of up to 100 characters");
    out.eligible_departments = depts;
  }
  oneOf("kind", "kind", PACKAGE_KINDS);
  oneOf("approval", "approval", APPROVAL_ROUTES);
  oneOf("approvalMode", "approval_mode", APPROVAL_MODES);
  oneOf("onTimeout", "on_timeout", ON_TIMEOUT);
  oneOf("certificationFrequency", "certification_frequency", CERTIFICATION_FREQUENCIES);
  if (has("approvalTimeoutDays")) {
    const n = Number(input.approvalTimeoutDays);
    if (!Number.isInteger(n) || n < 1 || n > 60) fail("approvalTimeoutDays: 1 to 60 days");
    out.approval_timeout_days = n;
  }
  for (const [k, col] of [
    ["maxDurationDays", "max_duration_days"],
    ["defaultDurationDays", "default_duration_days"],
  ] as const) {
    if (!has(k)) continue;
    const v = input[k];
    if (v === null || v === "") {
      out[col] = null;
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 3650) fail(`${k}: 1 to 3650 days, or empty`);
    out[col] = n;
  }
  if (typeof out.max_duration_days === "number" && typeof out.default_duration_days === "number" && out.default_duration_days > out.max_duration_days) {
    fail("defaultDurationDays: cannot exceed the maximum");
  }
  return out;
}

/** A stable digest of what a package includes, for the approval fingerprint: changing the contents needs approval again. */
export function contentsDigest(resources: { applicationId: string; entitlementId: string | null; privilegeLevel: string | null }[]): string {
  return resources
    .map((r) => `${r.applicationId}:${r.entitlementId ?? "*"}:${r.privilegeLevel ?? "-"}`)
    .sort()
    .join("|");
}

// ------------------------------------------------------------ birthright

/**
 * IDENTITY-P0-18 / ACCESS-P0-20 (owner decision, 13 October 2026): a
 * birthright package is assigned automatically to people who join, are
 * rehired or move and are eligible. Marking it birthright is the approval,
 * so it takes two administrators: one asks, someone else approves.
 * Turning it off takes one. The database refuses 'on' without a different
 * approver as well (migration 0151).
 */
export const BIRTHRIGHT_STATUSES = ["off", "pending", "on"] as const;
export type BirthrightStatus = (typeof BIRTHRIGHT_STATUSES)[number];
export type BirthrightAction = "request" | "approve" | "off";

export type BirthrightState = { status: BirthrightStatus; requestedBy: string | null };

export function birthrightTransition(
  current: BirthrightState,
  action: BirthrightAction,
  actorId: string,
): { ok: true; next: BirthrightStatus } | { ok: false; code: string; message: string } {
  if (action === "off") return current.status === "off" ? { ok: false, code: "INVALID_TRANSITION", message: "Birthright is already off" } : { ok: true, next: "off" };
  if (action === "request") {
    if (current.status !== "off") return { ok: false, code: "INVALID_TRANSITION", message: current.status === "on" ? "Birthright is already on" : "Birthright is already waiting for approval" };
    return { ok: true, next: "pending" };
  }
  if (current.status !== "pending") return { ok: false, code: "INVALID_TRANSITION", message: "Nothing is waiting for approval" };
  if (current.requestedBy === actorId) return { ok: false, code: "FOUR_EYES", message: "Someone other than the person who asked must approve birthright" };
  return { ok: true, next: "on" };
}

/** Package fields whose change sends birthright back for approval: who gets it. */
export const BIRTHRIGHT_SCOPE_FIELDS = ["eligible_identity_types", "eligible_departments"] as const;

/** Whether a change to a package (its fields, or a resource added or removed) needs birthright approved again. */
export function birthrightNeedsReapproval(status: BirthrightStatus, change: { fields?: string[]; resources?: boolean }): boolean {
  if (status !== "on") return false;
  return Boolean(change.resources) || (change.fields ?? []).some((f) => (BIRTHRIGHT_SCOPE_FIELDS as readonly string[]).includes(f));
}

/** Whether a birthright package goes to this person now: on, active, and they are eligible. */
export function birthrightApplies(
  pkg: PackageEligibility & { status: string; birthrightStatus: BirthrightStatus },
  subject: EligibilitySubject,
): boolean {
  return pkg.birthrightStatus === "on" && pkg.status === "active" && checkEligibility(pkg, subject).eligible;
}

/** WID-H09 (owner decision, 13 Oct): how long a mover's manager has to keep a birthright package they no longer qualify for. */
export const MOVER_REVIEW_DAYS = 14;

/**
 * WID-H09: what a move means for one birthright assignment the person holds.
 * - "review": they no longer qualify (identity type or department), so it
 *   goes to a dated review and is removed unless someone keeps it;
 * - "clear": it was under review and they qualify again, so the review ends;
 * - null: nothing to do (not birthright, not live, or unchanged).
 * The person's status is not part of this: leaving has its own removals.
 */
export function moverReviewAction(
  a: { source: string; status: string; reviewDueAt: string | null },
  pkg: PackageEligibility,
  subject: EligibilitySubject,
): "review" | "clear" | null {
  if (a.source !== "birthright" || !["provisioning", "active", "partially_failed"].includes(a.status)) return null;
  const qualifies = checkEligibility(pkg, { ...subject, status: "active" }).eligible;
  if (!qualifies && !a.reviewDueAt) return "review";
  if (qualifies && a.reviewDueAt) return "clear";
  return null;
}

/** The date a mover review ends: MOVER_REVIEW_DAYS from now. */
export function moverReviewDue(now: Date): string {
  return new Date(now.getTime() + MOVER_REVIEW_DAYS * 86_400_000).toISOString();
}

/**
 * WID-H09 (register, 13 Oct 13:07 IST): a mover review is decided by
 * someone else. The person whose access is under review may not keep it,
 * the same rule as deciding one's own request (WID-C01, SELF_APPROVAL).
 */
export function keepRefusal(actorIdentityId: string | null, assignmentIdentityId: string): "SELF_KEEP" | null {
  return actorIdentityId !== null && actorIdentityId === assignmentIdentityId ? "SELF_KEEP" : null;
}

// ---------------------------------------------------------------- ACCESS-P0-21

type Contents = { applicationId: string; entitlementId: string | null };
const contentKey = (c: Contents) => `${c.applicationId}:${c.entitlementId ?? ""}`;

/**
 * What a package grants: its own resources, then those of the active
 * packages it includes (and theirs), each once. `includes` maps a package to
 * the packages it includes; a cycle (refused by the database) is cut.
 * Inherited resources carry the package they come from.
 */
export function flattenContents<R extends Contents>(
  packageId: string,
  own: Map<string, R[]>,
  includes: Map<string, string[]>,
): (R & { fromPackageId: string | null })[] {
  const out: (R & { fromPackageId: string | null })[] = [];
  const seen = new Set<string>();
  const visited = new Set<string>();
  const walk = (id: string, from: string | null) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const r of own.get(id) ?? []) {
      if (seen.has(contentKey(r))) continue;
      seen.add(contentKey(r));
      out.push({ ...r, fromPackageId: from });
    }
    for (const child of includes.get(id) ?? []) walk(child, child);
  };
  walk(packageId, null);
  return out;
}

/** Why `includedId` cannot be added to `packageId`, or null. The database checks cycles again. */
export function includeRefusal(packageId: string, included: { id: string; status: string } | null, includes: Map<string, string[]>): string | null {
  if (!included) return "That role or package is not in this organization.";
  if (included.id === packageId) return "A role cannot include itself.";
  if (included.status !== "active") return "Only an active role or package can be included.";
  const below = new Set<string>();
  const stack = [included.id];
  while (stack.length) {
    const id = stack.pop()!;
    if (below.has(id)) continue;
    below.add(id);
    stack.push(...(includes.get(id) ?? []));
  }
  if (below.has(packageId)) return "That would make a loop: it already includes this role.";
  return null;
}

/** Access an identity holds as far as a simulation is concerned: anything not ended. */
const LIVE_LEDGER = ["VALID", "UNPROVEN", "ROGUE", "LEGACY_EXCEPTION", "PENDING_RECONCILIATION"];

export type SimulatedResource = Contents & { label: string; risk: RiskLevel };
export type RoleSimulation = {
  action: "add" | "remove";
  /** Access the change would give or take away. */
  changes: SimulatedResource[];
  /** Access the identity keeps (adding: already has it; removing: has it another way). */
  unchanged: SimulatedResource[];
  risk: RiskLevel;
};

/**
 * ACCESS-P0-21: what adding or removing a role would do to one identity's
 * access, without doing it. `entries` is the identity's access ledger;
 * `assignmentId` is its live assignment of the role (for a removal).
 */
export function simulateRoleChange(
  action: "add" | "remove",
  contents: SimulatedResource[],
  entries: { applicationId: string; entitlementId: string | null; status: string; accessPackageAssignmentId: string | null }[],
  assignmentId: string | null,
): RoleSimulation {
  const live = entries.filter((e) => LIVE_LEDGER.includes(e.status));
  const changes: SimulatedResource[] = [];
  const unchanged: SimulatedResource[] = [];
  for (const c of contents) {
    const held = live.filter((e) => e.applicationId === c.applicationId && (e.entitlementId ?? null) === c.entitlementId);
    if (action === "add") (held.length ? unchanged : changes).push(c);
    else (held.some((e) => e.accessPackageAssignmentId !== assignmentId) ? unchanged : changes).push(c);
  }
  return { action, changes, unchanged, risk: packageRisk(changes.map((c) => c.risk)) };
}

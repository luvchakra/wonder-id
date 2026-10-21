// Owner feedback (21 Oct): an identity's audit history in plain words. The
// audit trail records field names, never values, for changes to a person
// (personal data stays out of the append-only log, §17.7 and §18.3), so a
// line says which fields changed; a status says from what to what.

type Event = { action: string; objectType: string; outcome: string; metadata: Record<string, unknown> };

const ACTION: Record<string, string> = {
  "identity.created": "Identity created",
  "identity.created_from_accounts": "Identity created from accounts",
  "identity.updated": "Details changed",
  "identity.status_changed": "Status changed",
  "identity.relationship_added": "Relationship added",
  "identity.relationship_ended": "Relationship ended",
  "identity.lifecycle_event": "Lifecycle event",
  "identity.lifecycle_task_closed": "Lifecycle task closed",
  "identity.access_disabled": "Access disabled",
  "identity.end_date_reached": "End date reached",
  "identity.ownership_transferred": "Ownership transferred",
  "identity.merged": "Merged with another record",
  "identity.merge_undone": "Merge undone",
  "identity.rules_applied": "Identity rules applied",
  "identity.rule_task_opened": "Task opened by an identity rule",
  "identity.source_changes_undone": "Changes from a source undone",
  "access.request_submitted": "Access requested",
  "access.request_cancelled": "Access request cancelled",
  "access.request_expired": "Access request expired",
  "access.request_refused": "Access request refused",
  "access.approval_chain_started": "Approval started",
  "account.reconciled": "Account reconciled",
  "user.invited": "Invited to WonderID",
  "user.invitation_accepted": "Invitation accepted",
  "user.updated": "Account details changed",
  "user.sessions_revoked": "Signed out everywhere",
  "role.assigned": "ID role assigned",
  "role.removed": "ID role removed",
  "role.assignment_changed": "ID role changed",
};

const FIELD: Record<string, string> = {
  displayName: "full name",
  managerIdentityId: "manager",
  ownerIdentityId: "owner",
  sponsorIdentityId: "sponsor",
  sourceRef: "source reference",
};

/** camelCase or snake_case to plain words. */
const words = (s: string) => s.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

/** "access.request_submitted" → "Request submitted", for an action without its own label. */
function fallback(action: string): string {
  const tail = words(action.split(".").pop() ?? action);
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

export function describeAuditEvent(e: Event): { title: string; detail: string | null } {
  const title = ACTION[e.action] ?? fallback(e.action);
  const m = e.metadata ?? {};
  const parts: string[] = [];
  if (Array.isArray(m.changed) && m.changed.length) parts.push(`Changed: ${m.changed.map((f) => FIELD[String(f)] ?? words(String(f))).join(", ")}`);
  if (typeof m.from === "string" && typeof m.to === "string") parts.push(`from ${words(m.from)} to ${words(m.to)}`);
  if (e.objectType === "access_request" && !e.action.startsWith("access.request")) parts.push("on an access request");
  if (e.objectType === "account") parts.push("on an account");
  return { title, detail: parts.length ? parts.join(" · ") : null };
}

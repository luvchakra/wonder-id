// Owner feedback (21 Oct): a waiting policy change, in the words of the
// policy form instead of column names and raw ids.

const FIELD: Record<string, string> = {
  name: "Name",
  status: "Status",
  requestable: "Requestable",
  allow_self: "Request for yourself",
  allow_for_others: "Request for others",
  justification_required: "Justification required",
  max_duration_days: "Longest duration (days)",
  default_duration_days: "Default duration (days)",
  risk_threshold: "Auto-approve below risk",
  auto_approve: "Auto-approve",
  approval: "Approved by",
  approval_mode: "Approval order",
  approval_timeout_days: "Days to decide",
  on_timeout: "After that",
  approval_workflow_id: "Approval workflow",
};

const VALUE: Record<string, Record<string, string>> = {
  allow_for_others: { none: "Nobody", managers: "Managers and access managers", access_managers: "Access managers" },
  approval: { manager_approval: "Manager", owner_approval: "Owner", manager_and_owner: "Manager and owner" },
  approval_mode: { sequential: "In order", parallel: "At the same time" },
  on_timeout: { escalate: "Escalate to access managers", expire: "Expire the request" },
};

export function changeLabel(field: string): string {
  return FIELD[field] ?? field.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** A value as the form shows it; a workflow by its name. Empty is "—". */
export function changeValue(field: string, value: unknown, workflowName: (id: string) => string | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field === "approval_workflow_id") return workflowName(String(value)) ?? "A workflow no longer there";
  return VALUE[field]?.[String(value)] ?? String(value).replace(/^./, (c) => c.toUpperCase());
}

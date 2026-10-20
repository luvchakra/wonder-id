"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { savePolicyAction, type RequestFormState } from "@/app/actions/requests";
import { Button, SelectField, TextField } from "@/modules/ui";

// ACCESS-P0-18 — create or update the request policy for one scope. The
// server validates every field and records the change (§17.5, #11).
// ACCESS-P0-19 adds how the approvers decide and what happens on timeout.
// Grouped into who can request, approval and duration (feedback item 17).

const IDLE: RequestFormState = { status: "idle" };

export type PolicyDefaults = {
  name: string;
  requestable: boolean;
  allowSelf: boolean;
  allowForOthers: string;
  maxDurationDays: number | null;
  defaultDurationDays: number | null;
  justificationRequired: boolean;
  riskThreshold: string;
  autoApprove: boolean;
  /** The "Approved by" choice: `workflow:<id>` or a built-in route (approvalChoiceOf). */
  approvalChoice: string;
  approvalTimeoutDays: number;
  onTimeout: string;
  status: string;
  approvalWorkflowId?: string | null;
};

export function PolicyForm({
  applicationId,
  entitlements,
  defaults,
  workflows,
}: {
  applicationId: string | null;
  entitlements: { id: string; name: string }[];
  defaults: PolicyDefaults;
  /** Approval workflows: the active ones this organization has. */
  workflows: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(savePolicyAction, IDLE);
  const check = (name: string, label: string, on: boolean) => (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input type="checkbox" name={name} defaultChecked={on} className="size-4 accent-primary" />
      {label}
    </label>
  );
  const section = (title: string, children: React.ReactNode) => (
    <div role="group" aria-label={title} className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:col-span-2 sm:grid-cols-2">
      <h3 className="text-sm font-semibold text-foreground sm:col-span-2">{title}</h3>
      {children}
    </div>
  );
  // The current workflow stays choosable even if it was retired since.
  const current = defaults.approvalWorkflowId && !workflows.some((w) => w.id === defaults.approvalWorkflowId) ? [{ id: defaults.approvalWorkflowId, name: "The current workflow (retired)" }] : [];
  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {applicationId ? <input type="hidden" name="applicationId" value={applicationId} /> : null}
      {applicationId ? (
        <SelectField label="Applies to" name="entitlementId" defaultValue="">
          <option value="">The whole application</option>
          {entitlements.map((e) => (
            <option key={e.id} value={e.id}>
              Only {e.name}
            </option>
          ))}
        </SelectField>
      ) : (
        <p className="text-sm text-muted-foreground sm:col-span-2">The organization&apos;s default: it applies wherever no application or entitlement policy does.</p>
      )}
      <TextField label="Name" name="name" required maxLength={200} defaultValue={defaults.name} />
      <SelectField label="Status" name="status" defaultValue={defaults.status}>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </SelectField>

      {section(
        "Who can request",
        <>
          <SelectField label="Requesting for someone else" name="allowForOthers" defaultValue={defaults.allowForOthers}>
            <option value="managers">Their manager or an access manager</option>
            <option value="access_managers">Only access managers</option>
            <option value="none">Nobody (self only)</option>
          </SelectField>
          <div className="space-y-2 sm:pt-6">
            {check("requestable", "Requestable", defaults.requestable)}
            {check("allowSelf", "People may request for themselves", defaults.allowSelf)}
            {check("justificationRequired", "A justification is required", defaults.justificationRequired)}
          </div>
        </>,
      )}

      {section(
        "Approval",
        <>
          {/* One choice instead of workflow, route and order (owner test feedback item 17, 2026-10-20). */}
          <div>
            <SelectField label="Approved by" name="approvalChoice" defaultValue={defaults.approvalChoice}>
              {workflows.length + current.length ? (
                <optgroup label="Approval workflows">
                  {[...workflows, ...current].map((w) => (
                    <option key={w.id} value={`workflow:${w.id}`}>
                      {w.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="Built in">
                <option value="manager_approval">Manager</option>
                <option value="owner_approval">Owner (entitlement, else application)</option>
                <option value="manager_and_owner:sequential">Manager, then owner</option>
                <option value="manager_and_owner:parallel">Manager and owner at the same time</option>
              </optgroup>
            </SelectField>
            <Link href="/access/approval-workflows" className="mt-1 inline-block text-xs text-primary hover:underline">
              {workflows.length ? "Manage approval workflows" : "Create an approval workflow for more levels"}
            </Link>
          </div>
          <TextField label="Days each approver has" name="approvalTimeoutDays" type="number" min={1} max={60} required defaultValue={defaults.approvalTimeoutDays} />
          <SelectField label="When an approver does not decide in time" name="onTimeout" defaultValue={defaults.onTimeout}>
            <option value="escalate">Escalate to access managers once, then expire</option>
            <option value="expire">Expire the request</option>
          </SelectField>
          <SelectField label="Always needs approval from risk" name="riskThreshold" defaultValue={defaults.riskThreshold}>
            <option value="low">Low (every request)</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </SelectField>
          <div className="sm:col-span-2">{check("autoApprove", "Approve automatically below that risk", defaults.autoApprove)}</div>
        </>,
      )}

      {section(
        "How long access lasts",
        <>
          <TextField label="Default duration (days)" name="defaultDurationDays" type="number" min={1} max={3650} defaultValue={defaults.defaultDurationDays ?? ""} />
          <TextField label="Longest duration (days)" name="maxDurationDays" type="number" min={1} max={3650} defaultValue={defaults.maxDurationDays ?? ""} hint="Empty: no limit" />
        </>,
      )}

      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Saving…" : "Save policy"}
        </Button>
        <p role="status" className="text-xs">
          {state.status === "saved" ? <span className="text-success">{state.message}</span> : null}
          {state.status === "error" ? <span className="text-destructive">{state.message}</span> : null}
        </p>
      </div>
    </form>
  );
}

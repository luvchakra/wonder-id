"use client";

import { useActionState, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { createWorkflowAction, setWorkflowStatusAction, updateWorkflowAction, type WorkflowFormState } from "@/app/actions/approvalWorkflows";
import { Button, TextField, TextareaField, fieldInputClass } from "@/modules/ui";
import { APPROVER_LABEL, MAX_APPROVERS_PER_LEVEL, MAX_LEVELS, WORKFLOW_APPROVER_KINDS, type WorkflowApprover, type WorkflowLevel } from "@/modules/access-governance/approvalWorkflowRules";

// Approval workflows — build a pattern level by level: who approves, whether
// all of them or any one must, and from which risk the level applies. The
// levels travel as JSON; the server validates them and checks every named
// person and group is in this organization.

const IDLE: WorkflowFormState = { status: "idle" };
type Kind = (typeof WORKFLOW_APPROVER_KINDS)[number];
type Option = { id: string; name: string };

const blankLevel = (n: number): WorkflowLevel => ({ name: `Level ${n}`, rule: "all", minRisk: null, approvers: [{ kind: "manager" }] });

function approverFor(kind: Kind, people: Option[], groups: Option[]): WorkflowApprover {
  if (kind === "person") return { kind, identityId: people[0]?.id ?? "" };
  if (kind === "group") return { kind, groupId: groups[0]?.id ?? "" };
  return { kind };
}

function Status({ state }: { state: WorkflowFormState }) {
  return (
    <p role="status" className="text-xs">
      {state.status === "saved" ? <span className="text-success">{state.message}</span> : null}
      {state.status === "error" ? <span className="text-destructive">{state.message}</span> : null}
    </p>
  );
}

export function WorkflowForm({
  workflowId,
  defaults,
  people,
  groups,
}: {
  /** Set when editing; absent when creating. */
  workflowId?: string;
  defaults?: { name: string; description: string | null; levels: WorkflowLevel[] };
  people: Option[];
  groups: Option[];
}) {
  const [state, action, pending] = useActionState(workflowId ? updateWorkflowAction.bind(null, workflowId) : createWorkflowAction, IDLE);
  const [levels, setLevels] = useState<WorkflowLevel[]>(defaults?.levels.length ? defaults.levels : [blankLevel(1)]);
  const kinds = WORKFLOW_APPROVER_KINDS.filter((k) => (k === "person" ? people.length > 0 : k === "group" ? groups.length > 0 : true));

  const setLevel = (i: number, patch: Partial<WorkflowLevel>) => setLevels((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setApprover = (i: number, a: number, value: WorkflowApprover) => setLevel(i, { approvers: levels[i].approvers.map((x, b) => (b === a ? value : x)) });

  return (
    <form action={action} className="space-y-4">
      <TextField label="Name" name="name" required maxLength={120} defaultValue={defaults?.name ?? ""} placeholder="Manager, then security" />
      <TextareaField label="Description" name="description" rows={2} maxLength={1000} defaultValue={defaults?.description ?? ""} />
      <input type="hidden" name="levels" value={JSON.stringify(levels)} />
      <ol className="space-y-3">
        {levels.map((level, i) => (
          <li key={i} className="rounded-md border border-border p-3" aria-label={`Level ${i + 1}`}>
            <div className="flex flex-wrap items-end gap-2">
              <span className="text-xs font-medium text-muted-foreground">{i + 1}.</span>
              <input aria-label={`Level ${i + 1} name`} className={`${fieldInputClass} w-auto min-w-[10rem] flex-1`} maxLength={80} value={level.name} onChange={(e) => setLevel(i, { name: e.target.value })} />
              <select aria-label={`Level ${i + 1} rule`} className={`${fieldInputClass} w-auto`} value={level.rule} onChange={(e) => setLevel(i, { rule: e.target.value === "any" ? "any" : "all" })}>
                <option value="all">All must approve</option>
                <option value="any">Any one approves</option>
              </select>
              <select aria-label={`Level ${i + 1} applies from`} className={`${fieldInputClass} w-auto`} value={level.minRisk ?? ""} onChange={(e) => setLevel(i, { minRisk: (e.target.value || null) as WorkflowLevel["minRisk"] })}>
                <option value="">Every request</option>
                <option value="medium">Medium risk and above</option>
                <option value="high">High risk and above</option>
                <option value="critical">Critical risk only</option>
              </select>
              {levels.length > 1 ? (
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove level ${i + 1}`} onClick={() => setLevels((ls) => ls.filter((_, j) => j !== i))}>
                  <X className="size-4" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
            <ul className="mt-2 space-y-2">
              {level.approvers.map((ap, a) => (
                <li key={a} className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={`Level ${i + 1} approver ${a + 1}`}
                    className={`${fieldInputClass} w-auto`}
                    value={ap.kind}
                    onChange={(e) => setApprover(i, a, approverFor(e.target.value as Kind, people, groups))}
                  >
                    {kinds.map((k) => (
                      <option key={k} value={k}>
                        {APPROVER_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  {ap.kind === "person" ? (
                    <select aria-label={`Level ${i + 1} approver ${a + 1} person`} className={`${fieldInputClass} w-auto`} value={ap.identityId} onChange={(e) => setApprover(i, a, { kind: "person", identityId: e.target.value })}>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {ap.kind === "group" ? (
                    <select aria-label={`Level ${i + 1} approver ${a + 1} group`} className={`${fieldInputClass} w-auto`} value={ap.groupId} onChange={(e) => setApprover(i, a, { kind: "group", groupId: e.target.value })}>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {level.approvers.length > 1 ? (
                    <Button type="button" variant="ghost" size="sm" aria-label={`Remove approver ${a + 1} of level ${i + 1}`} onClick={() => setLevel(i, { approvers: level.approvers.filter((_, b) => b !== a) })}>
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {level.approvers.length < MAX_APPROVERS_PER_LEVEL ? (
              <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => setLevel(i, { approvers: [...level.approvers, { kind: "resource_owner" }] })}>
                <Plus className="size-4" aria-hidden="true" /> Add approver
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
      {levels.length < MAX_LEVELS ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => setLevels((ls) => [...ls, blankLevel(ls.length + 1)])}>
          <Plus className="size-4" aria-hidden="true" /> Add level
        </Button>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Saving…" : workflowId ? "Save changes" : "Create workflow"}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function WorkflowStatusButton({ workflowId, status }: { workflowId: string; status: "active" | "retired" }) {
  const next = status === "active" ? "retired" : "active";
  const [state, action, pending] = useActionState(setWorkflowStatusAction.bind(null, workflowId, next), IDLE);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {next === "retired" ? "Retire workflow" : "Restore workflow"}
      </Button>
      <Status state={state} />
    </form>
  );
}

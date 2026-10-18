"use client";

import { useActionState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { addAccessConflictRuleAction, type AccessRuleState } from "@/app/actions/access";
import { Button, SelectField, useCloseCreateDialog } from "@/modules/ui";

// ACCESS-P0-22 — a rule naming access one identity must not hold together.
// The rule joins an identity policy as a new version; the policy decides
// whether a conflict is refused (block) or allowed and recorded.

const IDLE: AccessRuleState = { status: "idle" };

export function AccessRuleForm({ policies, entitlements }: { policies: { id: string; label: string }[]; entitlements: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(addAccessConflictRuleAction, IDLE);
  const close = useCloseCreateDialog();
  useEffect(() => {
    if (state.status === "saved") close();
  }, [state, close]);
  if (!policies.length) return <p className="text-sm text-muted-foreground">Create an identity policy first; the rule belongs to one.</p>;
  if (entitlements.length < 2) return <p className="text-sm text-muted-foreground">Rules name entitlements; this organization has fewer than two.</p>;
  const list = (name: string, label: string) => (
    <SelectField label={label} name={name} multiple required size={Math.min(8, entitlements.length)} hint="Hold Ctrl or Cmd to choose several">
      {entitlements.map((e) => (
        <option key={e.id} value={e.id}>
          {e.label}
        </option>
      ))}
    </SelectField>
  );
  return (
    <form action={action} className="space-y-4">
      <SelectField label="Identity policy" name="policyId" required defaultValue="" hint="Its action decides: block refuses, anything else allows and records">
        <option value="" disabled>
          Choose one
        </option>
        {policies.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </SelectField>
      {list("left", "Access on one side")}
      {list("right", "Must not be held with")}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
          Add rule
        </Button>
        {state.status === "error" ? (
          <p role="alert" className="text-xs text-destructive">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

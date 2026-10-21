"use client";

import { useActionState } from "react";
import { PendingSubmitButton } from "@/modules/ui";
import { withdrawAction, type WithdrawState } from "../actions";

/** Withdrawing can't be undone; the hiring team is told and nothing more happens to the application. */
export function WithdrawForm({ token }: { token: string }) {
  const [state, action] = useActionState<WithdrawState, FormData>(withdrawAction, { status: "idle" });
  if (state.status === "done") return <p role="status" className="mt-6 text-sm font-medium text-foreground">Your application is withdrawn. You&rsquo;ll get a confirmation email.</p>;
  return (
    <details className="mt-6 text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Withdraw my application</summary>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="token" value={token} />
        <p className="text-muted-foreground">The team will stop considering you for this position. This can&rsquo;t be undone, but you can apply again for other roles.</p>
        {state.status === "error" && (
          <p role="alert" className="text-destructive">
            {state.message}
          </p>
        )}
        <PendingSubmitButton variant="destructive" size="sm" pendingLabel="Withdrawing…">
          Withdraw application
        </PendingSubmitButton>
      </form>
    </details>
  );
}

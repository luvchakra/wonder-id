"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, fieldInputClass } from "@/modules/ui";

/**
 * ACCESS-P0-35 — approve (apply) or reject a waiting change; the server checks who may and says why not.
 * Owner decision 2026-10-21: an administrator may approve their own change, saying why (a note is
 * required); they cannot reject it.
 */
export function ChangeDecision({ id, own = false }: { id: string; own?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const decide = (decision: "approved" | "rejected") =>
    start(async () => {
      const res = await fetch(`/api/v1/access/governance-changes/${id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(own ? { decision, note } : { decision }),
      });
      const json = await res.json().catch(() => ({}));
      const err = !res.ok || !json.ok ? (json.error?.message ?? "It could not be decided") : null;
      setError(err);
      if (!err) router.refresh();
    });
  return (
    <span className="flex flex-wrap items-center gap-2">
      {own ? (
        <input
          aria-label="Why you approve your own change"
          placeholder="Why you approve your own change"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          className={`${fieldInputClass} h-8 w-56 text-xs`}
        />
      ) : null}
      <Button size="sm" disabled={pending || (own && !note.trim())} onClick={() => decide("approved")}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Approve
      </Button>
      {own ? null : (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("rejected")}>
          Reject
        </Button>
      )}
      {error ? (
        <span role="status" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}

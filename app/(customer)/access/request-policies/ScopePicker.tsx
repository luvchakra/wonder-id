"use client";

import { useRouter } from "next/navigation";
import { SelectField } from "@/modules/ui";

/**
 * Where the policy being set applies. Choosing opens that scope's policy at
 * once (owner test feedback item 17, 2026-10-20): the separate Choose button
 * left the form showing another scope's policy until it was pressed.
 */
export function ScopePicker({ value, options }: { value: string; options: { id: string; name: string }[] }) {
  const router = useRouter();
  return (
    <div className="max-w-xl">
      <SelectField
        label="Scope"
        name="app"
        value={value}
        onChange={(e) => router.push(e.target.value ? `/access/request-policies?app=${e.target.value}#set-policy` : "/access/request-policies#set-policy", { scroll: false })}
      >
        <option value="">Organization default</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

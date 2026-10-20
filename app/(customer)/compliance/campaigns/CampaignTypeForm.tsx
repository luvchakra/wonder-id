"use client";

import { useEffect, useState } from "react";
import { Button, SelectField, TextField } from "@/modules/ui";
import { CAMPAIGN_TRIGGER_EVENTS, CAMPAIGN_TYPE_INFO, CAMPAIGN_TYPES, TRIGGER_LABEL, campaignFromType, type CampaignType } from "@/modules/certification-compliance/campaignTypes";
import { CampaignPreviewButton } from "./CampaignPreviewButton";

type Option = { id: string; name: string };
type Targets = { applications: Option[]; packages: (Option & { birthright: boolean })[]; members: { userId: string; name: string }[] };

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url).catch(() => null);
  const body = res ? await res.json().catch(() => null) : null;
  return res?.ok && body?.ok ? (body.data as T) : null;
}

/** A search box over a list the server filters (entitlements, people), and the matches to choose from. */
function SearchSelect({ label, name, kind, value, onChange }: { label: string; name: string; kind: "entitlements" | "people"; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<Option[] | null>(null);
  useEffect(() => {
    const t = setTimeout(async () => setOptions(await getJson<Option[]>(`/api/v1/compliance/campaign-targets?${kind}=${encodeURIComponent(q)}`)), 250);
    return () => clearTimeout(t);
  }, [q, kind]);
  return (
    <div className="grid grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-2">
      <TextField label={`Find ${label.toLowerCase()}`} name={`${name}Search`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to search" autoComplete="off" />
      <SelectField label={label} name={name} required value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{options === null ? "Searching…" : options.length ? "Choose…" : "No matches"}</option>
        {(options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

/**
 * COMPLIANCE-P0-15: Create Campaigns starts from a campaign type. Each type
 * asks only for its target; the reviewer follows from the type, and the
 * fallback reviewer takes what nobody else can review. "Custom" keeps the
 * full launch form. An event-based type is saved, not launched: it starts
 * a campaign by itself when its event happens.
 */
export function CampaignTypeForm({ action, autoFocus }: { action: (formData: FormData) => void | Promise<void>; autoFocus?: boolean }) {
  const [type, setType] = useState<CampaignType>("user_manager");
  const [targets, setTargets] = useState<Targets | null>(null);
  const [applicationId, setApplicationId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [entitlementId, setEntitlementId] = useState("");
  const [identityId, setIdentityId] = useState("");
  const [personAccess, setPersonAccess] = useState<Option[] | null>(null);
  const [privilegedOnly, setPrivilegedOnly] = useState(false);
  const [triggers, setTriggers] = useState<string[]>(["mover", "manager_change"]);
  const [microReviewer, setMicroReviewer] = useState("manager");
  const [reviewerId, setReviewerId] = useState("");

  useEffect(() => {
    getJson<Targets>("/api/v1/compliance/campaign-targets").then((t) => setTargets(t ?? { applications: [], packages: [], members: [] }));
  }, []);
  function choosePerson(id: string) {
    setIdentityId(id);
    setEntitlementId("");
    setPersonAccess(null);
    if (id) getJson<Option[]>(`/api/v1/compliance/campaign-targets?accessOf=${id}`).then((a) => setPersonAccess(a ?? []));
  }

  const info = CAMPAIGN_TYPE_INFO[type];
  const typed = type === "custom" ? null : campaignFromType(type, { applicationId, entitlementId, packageId, identityId, privilegedOnly, triggerEvents: triggers, microReviewer });
  const ready = type === "custom" || (typed !== null && !("error" in typed));
  const isEvent = type === "event_based";

  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-sm font-medium text-muted-foreground">Campaign type</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CAMPAIGN_TYPES.map((t) => (
            <label
              key={t}
              className={`flex cursor-pointer gap-2 rounded-lg border px-3 py-2 text-sm ${t === type ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
            >
              <input type="radio" name="campaignType" value={t} checked={t === type} onChange={() => setType(t)} className="mt-1" />
              <span className="min-w-0">
                <span className="block font-medium text-foreground">{CAMPAIGN_TYPE_INFO[t].label}</span>
                <span className="block text-xs text-muted-foreground">{CAMPAIGN_TYPE_INFO[t].summary}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="sm:col-span-2">
        <TextField key={type} label={isEvent ? "Template name" : "Campaign name"} name="name" required autoFocus={autoFocus} defaultValue={type === "custom" ? "" : `${info.label} review`} />
      </div>

      {type === "user_manager" || type === "application_owner" ? (
        <label className="flex items-center gap-2 text-sm text-muted-foreground sm:col-span-2">
          <input type="checkbox" name="privilegedOnly" checked={privilegedOnly} onChange={(e) => setPrivilegedOnly(e.target.checked)} /> Privileged access only
        </label>
      ) : null}

      {type === "application_owner" ? (
        <SelectField label="Application" name="applicationId" required value={applicationId} onChange={(e) => setApplicationId(e.target.value)}>
          <option value="">{targets ? "Choose…" : "Loading…"}</option>
          {(targets?.applications ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </SelectField>
      ) : null}

      {type === "role_based" ? (
        <SelectField label="Business role" name="packageId" required value={packageId} onChange={(e) => setPackageId(e.target.value)}>
          <option value="">{targets ? (targets.packages.length ? "Choose…" : "No active roles") : "Loading…"}</option>
          {(targets?.packages ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.birthright ? " (birthright)" : ""}
            </option>
          ))}
        </SelectField>
      ) : null}

      {type === "entitlement_owner" ? <SearchSelect label="Entitlement" name="entitlementId" kind="entitlements" value={entitlementId} onChange={setEntitlementId} /> : null}

      {type === "micro" ? (
        <>
          <SearchSelect label="Person" name="identityId" kind="people" value={identityId} onChange={choosePerson} />
          <SelectField label="Entitlement" name="entitlementId" required value={entitlementId} onChange={(e) => setEntitlementId(e.target.value)} disabled={!identityId}>
            <option value="">{!identityId ? "Choose the person first" : personAccess === null ? "Loading…" : personAccess.length ? "Choose…" : "They hold no access"}</option>
            {(personAccess ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Reviewed by" name="microReviewer" value={microReviewer} onChange={(e) => setMicroReviewer(e.target.value)}>
            <option value="manager">their manager</option>
            <option value="entitlement_owner">the entitlement&apos;s owner</option>
            <option value="named">the fallback reviewer</option>
          </SelectField>
        </>
      ) : null}

      {isEvent ? (
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-sm font-medium text-muted-foreground">Starts when a person has a</legend>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {CAMPAIGN_TRIGGER_EVENTS.map((e) => (
              <label key={e} className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  name="triggerEvents"
                  value={e}
                  checked={triggers.includes(e)}
                  onChange={(ev) => setTriggers((cur) => (ev.target.checked ? [...cur, e] : cur.filter((x) => x !== e)))}
                />
                {TRIGGER_LABEL[e]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {type === "custom" ? (
        <>
          <SelectField label="Scope type" name="scopeType" defaultValue="agent">
            <option value="agent">AI agents</option>
            <option value="application">applications (AI agents)</option>
            <option value="entitlement">entitlements (AI agents)</option>
            <option value="privileged_access">privileged access (AI agents)</option>
            <option value="high_risk_agent">high-risk AI agents</option>
            <option value="identity_access">people&apos;s access</option>
            <option value="role_assignments">WonderID roles</option>
            <option value="package_contents">access packages and business roles (owner review)</option>
            <option value="application_contents">applications (owner review)</option>
          </SelectField>
          <TextField label="Criticality filter" name="criticality" placeholder="e.g. high,critical" />
          <SelectField label="Cadence" name="cadence" defaultValue="one_time">
            <option value="one_time">one time</option>
            <option value="periodic">periodic</option>
            <option value="event_driven">event driven</option>
          </SelectField>
          <SelectField label="Reviewed by (people's access)" name="reviewerKind" defaultValue="named">
            <option value="named">the fallback reviewer</option>
            <option value="manager">each person&apos;s manager</option>
            <option value="application_owner">the application&apos;s owner</option>
            <option value="entitlement_owner">the entitlement&apos;s owner</option>
          </SelectField>
        </>
      ) : null}

      <TextField label="Days to review" name="dueInDays" type="number" min={1} max={365} defaultValue={isEvent || type === "micro" ? 7 : 30} key={`due-${type}`} />
      <SelectField label="Fallback reviewer" name="reviewerId" value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} hint={type === "custom" ? undefined : `${info.reviewer} reviews; this person takes what nobody else can.`}>
        <option value="">{isEvent ? "whoever saves this template" : "you"}</option>
        {(targets?.members ?? []).map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name}
          </option>
        ))}
      </SelectField>

      {!isEvent ? (
        <label className="flex items-center gap-2 text-sm text-muted-foreground sm:col-span-2">
          <input type="checkbox" name="saveTemplate" /> Also save as a template
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={!ready}>
          {isEvent ? "Save template" : "Launch"}
        </Button>
        {/* COMPLIANCE-P0-14: what it would hold, before launching (an event-based template has no one to count yet). */}
        {isEvent ? null : (
          <CampaignPreviewButton
            body={typed === null ? undefined : "error" in typed ? null : { scopeType: typed.scopeType, scope: typed.scope, reviewerKind: typed.reviewerKind, reviewerId: reviewerId || undefined }}
          />
        )}
        {typed && "error" in typed ? <span className="text-xs text-muted-foreground">{typed.error}</span> : null}
      </div>
    </form>
  );
}

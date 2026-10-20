import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getSmtpSettings, presetForHost, SMTP_PRESETS } from "@/modules/operations/service";
import { Card, CardBody, CardHeader, RecordProvenance, StatusBadge } from "@/modules/ui";
import { SmtpSettingsForm } from "./SmtpSettingsForm";

// Owner test feedback item 14 (2026-10-20): the organization's own outgoing
// mail server. When it is set and turned on, notifications and invitations
// go out through it; otherwise through WonderID's own provider.
export default async function EmailSettingsPage() {
  let ctx;
  try {
    ctx = await requirePermission("notification.manage");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }

  const saved = await getSmtpSettings(ctx.tenantId!);
  const test = saved?.lastTestAt
    ? saved.lastTestOk
      ? { tone: "success" as const, text: "Last test sent" }
      : { tone: "danger" as const, text: "Last test failed" }
    : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Email (SMTP)</h1>
        <p className="mt-1 text-sm text-muted-foreground">Send this organization&apos;s e-mail, such as notifications and invitations, through your own mail server.</p>
        {saved ? <RecordProvenance record={saved.provenance} className="mt-1" /> : null}
      </div>

      <Card>
        <CardHeader
          title="Mail server"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {saved ? (
                saved.enabled ? <StatusBadge tone="success">In use</StatusBadge> : <StatusBadge tone="neutral">Turned off</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">Not set up: WonderID sends your e-mail</StatusBadge>
              )}
              {test ? <StatusBadge tone={test.tone}>{test.text}</StatusBadge> : null}
            </div>
          }
        />
        <CardBody className="space-y-3">
          {saved && saved.lastTestOk === false && saved.lastTestError ? <p className="text-sm text-destructive">{saved.lastTestError}</p> : null}
          <SmtpSettingsForm
            presets={SMTP_PRESETS}
            initialPreset={saved ? (presetForHost(saved.host)?.id ?? "") : "godaddy"}
            saved={
              saved
                ? {
                    enabled: saved.enabled,
                    host: saved.host,
                    port: saved.port,
                    security: saved.security,
                    username: saved.username,
                    hasPassword: saved.hasPassword,
                    fromEmail: saved.fromEmail,
                    fromName: saved.fromName,
                  }
                : null
            }
          />
        </CardBody>
      </Card>
    </div>
  );
}

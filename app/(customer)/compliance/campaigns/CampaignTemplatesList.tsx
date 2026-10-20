import { archiveTemplateAction, launchFromTemplateAction } from "@/app/actions/compliance";
import { Button, Card, CardHeader } from "@/modules/ui";
import { CAMPAIGN_TYPE_INFO, TRIGGER_LABEL } from "@/modules/certification-compliance/campaignTypes";
import type { CampaignTemplate } from "@/modules/certification-compliance/service";

const SCOPE_LABEL: Record<string, string> = {
  identity_access: "people's access",
  role_assignments: "WonderID roles",
  package_contents: "access packages and roles",
  application_contents: "applications",
  role_membership: "business role members",
};

/**
 * COMPLIANCE-P0-14: saved launches; one action each (§19.5). COMPLIANCE-P0-15:
 * each shows its campaign type; an event-based one launches by itself, so
 * its one action turns it off.
 */
export function CampaignTemplatesList({ templates }: { templates: CampaignTemplate[] }) {
  return (
    <Card>
      <CardHeader title="Templates" />
      <ul className="divide-y divide-border">
        {templates.map((t) => {
          const event = t.campaignType === "event_based";
          return (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{t.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {t.campaignType === "custom" ? (SCOPE_LABEL[t.scopeType] ?? t.scopeType) : CAMPAIGN_TYPE_INFO[t.campaignType].label}
                  {t.scope.privilegedOnly ? " · privileged only" : ""}
                  {event ? ` · starts on ${t.triggerEvents.map((e) => TRIGGER_LABEL[e].toLowerCase()).join(", ")}` : ""}
                  {t.dueInDays ? ` · ${t.dueInDays} days to review` : ""}
                </span>
              </span>
              <form action={(event ? archiveTemplateAction : launchFromTemplateAction).bind(null, t.id)}>
                <Button type="submit" variant="secondary" size="sm">
                  {event ? "Turn off" : "Launch"}
                </Button>
              </form>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

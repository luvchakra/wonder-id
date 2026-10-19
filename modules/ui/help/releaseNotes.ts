/**
 * Release notes, shown under Get Help › Release notes (owner request,
 * 2026-10-19). Newest first.
 *
 * When the owner confirms that a new version is live, add one entry at the
 * top (CLAUDE.md §19.7): high-level notes on every user-facing feature
 * merged since the previous entry, found with
 * `git log <previous entry's commit>..<live commit>`. Each note links to
 * the guide section that describes it. `commit` is the production commit
 * that was live when the entry was written, so the next entry starts from
 * it. Describe only what is live, in the UI's own words.
 */

export type ReleaseNote = {
  /** Anchor id, `release-YYYY-MM-DD` (a second release on one day adds `-2`). */
  id: string;
  /** The day the owner confirmed it live (YYYY-MM-DD). */
  date: string;
  /** The live production commit, short form. */
  commit: string;
  /** One line on the release as a whole. */
  summary: string;
  /** One per feature: what it is, and the guide section that explains it. */
  highlights: { label: string; note: string; section: string }[];
};

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    id: "release-2026-10-19",
    date: "2026-10-19",
    commit: "c90afe4",
    summary: "The first release notes: everything that went live from 14 to 19 October 2026.",
    highlights: [
      { label: "Approval workflows", note: "Approval patterns with up to six levels, all or any one approver per level and levels by risk; one workflow serves many applications.", section: "access-requests" },
      { label: "Several requests at once", note: "Baskets for one or more people, the same access as a colleague, drafts, approval from a message link, and a REQ number with a barcode for every request.", section: "access-requests" },
      { label: "Business and IT roles", note: "Roles are access packages that can include other roles, with a simulation of adding or removing one.", section: "access-packages" },
      { label: "Separation of duties over access", note: "Rules on access one identity must not hold together, checked at request, assignment and approval; identities already holding both are listed.", section: "separation-of-duties" },
      { label: "Access reviews for everyone", note: "Reviews of people's application access, ID roles, package contents and application entitlements; defer, escalate and exceptions; templates, a calendar and analytics.", section: "certification" },
      { label: "Delegation", note: "Hand your approvals, requests or administration to a colleague until a date, and let an AI agent act for you once its owner approves.", section: "delegations" },
      { label: "Merging duplicate people", note: "Compare two records of the same person, keep the values you choose, merge them and undo it if needed.", section: "identities" },
      { label: "Identity rules", note: "Rules run when a person joins, moves, gets a new manager or leaves, and can open a task, add to a group or assign a package.", section: "identity-rules" },
      { label: "Provisioning to people and groups", note: "Tasks go to a person or a group per application, can be reassigned, and new accounts are named by the application's format.", section: "fulfilment" },
      { label: "Applications", note: "Pages with tabs, entitlement types and classification rules, entitlements added by hand, and onboarding templates with a questionnaire.", section: "applications" },
      { label: "Policy versions", note: "Every change to a governance or request policy is a numbered version with what changed; with two or more administrators, a request policy change waits for a second person.", section: "policies" },
      { label: "Configuration export and import", note: "Global Configuration, identity attributes included, moves between environments as a signed file, with a preview of every change.", section: "global-configuration" },
      { label: "API clients", note: "Pipelines call the WonderID API with their own roles, approved by a second administrator.", section: "api-clients" },
      { label: "MCP tools that are AI agents", note: "Labelled on the MCP page, trusted when the server declares them, and listed in Agent Discovery.", section: "integrations" },
      { label: "Getting around", note: "Pages open at short numbers, list forms sit in the Actions menu, a More button on phones, and one installed app for every organization.", section: "navigating" },
    ],
  },
];

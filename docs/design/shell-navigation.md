# WonderID shell navigation

Detail for CLAUDE.md §13. The rules in CLAUDE.md win if they ever differ.
Source: `modules/ui/shell-nav.ts`. Owner's working copy: Google Sheet "WonderID: proposed navigation".

Adopted 2026-09-26 (WonderID mockups in `docs/requirements/wonderid-*.png`). The sidebar
follows the branding specification's light console (later the same day, superseding a dark
navy rail). Content surfaces, tokens and both themes are unchanged.

## Shape

- Collapsible left sidebar, with hover flyouts to the third level and a mobile drawer.
- White in light mode, a dark surface in dark mode. Active items use Electric Blue on a soft blue tint.
- Logo, colours and brand assets come only from `modules/ui/brand.ts` and `public/brand/`.
- A sidebar item appears only when its route and capability exist.
- Each area lists only the pages the viewer's permissions open.

## Areas (main sidebar, 2026-10-13, taken as final)

1. Home (the dashboard)
2. My Workspace
3. Access (Request Access first)
4. AI Agents
5. Access Reviews
6. Risk & Detection
7. Self Service
8. Administration (always last)

- Opening an area shows that area's menu, with a back arrow to the area list. This applies even to an area with one page.
- Each page and group in the menu has its own icon, at the size of an area row. Pages inside a group are listed under it without icons.
- Two menu items can be views of one page: My Requests and Approvals are `?view=` of the requests page. The current item is the one whose route and view match (`matchScore`).

## Administration

Opens the Admin sidebar: Identities, Applications, Policies & Controls, Reports & Audit,
Users & Roles, Integrations, Organization Settings, Privacy & Audit.

## Collapse

- A hamburger-style toggle at the top right collapses the sidebar to an icon rail.
- The rail shows: the toggle; a search icon that reopens the sidebar into its search box; the area icons; the W mark at the foot.

## Search and footer

- The search box matches menu items only, never data.
- The footer shows the product version and commit.

import type { ConnectorDefinition, SettingField } from "../types";

/**
 * Fix-list item 19 (owner request, 2026-10-20): any REST/JSON API, set up
 * in the connection's own settings rather than in a definition file. The
 * organization says how to authenticate, which request returns each kind of
 * record, where the records are in the response and how their fields map
 * (restApi.ts turns these settings into an ordinary definition, which the
 * same validator, engine and gateway then run).
 *
 * What is below is the type as the catalogue shows it: its settings, and
 * the kinds it can read. The requests and fields here are placeholders,
 * never run: a connection always runs the definition built from its own
 * settings (expandDefinition).
 */

const KIND_PLACEHOLDER = "GET /api/users\nrecords: data\nexternalId = id\nemail = profile.email | lower\ndisplayName = name, login";

function kindSetting(key: string, label: string, help: string): SettingField {
  return { key, label, type: "string", multiline: true, placeholder: KIND_PLACEHOLDER, help };
}

export const restApi: ConnectorDefinition = {
  schemaVersion: 1,
  key: "rest-api",
  version: "1.0.0",
  name: "Generic REST API",
  category: "application",
  description:
    "Any system with a REST/JSON API. You choose how it signs in, which request returns each kind of record and how the fields map, in the connection's settings. Can make changes you describe, once an administrator turns changes on for the connection.",
  driver: "http",
  settings: [
    { key: "baseUrl", label: "API address", type: "url", required: true, help: "The address every request path starts from, for example https://api.example.com/v1" },
    { key: "application", label: "Application name", type: "string", required: true, help: "How this system is named in WonderID" },
    {
      key: "authType",
      label: "Sign-in method",
      type: "select",
      default: "Bearer token",
      options: ["None", "Basic (user name and password)", "Bearer token", "API key in a header", "API key in the query string", "OAuth 2.0 client credentials", "OAuth 2.0 client credentials (HTTP Basic)"],
      help: "Bearer and API keys use the token; OAuth uses the client ID and secret",
    },
    { key: "apiKeyName", label: "API key name", type: "string", default: "X-API-Key", help: "The header or query parameter that carries the API key" },
    { key: "tokenUrl", label: "OAuth token address", type: "url", help: "For OAuth: the token endpoint, for example https://login.example.com/oauth2/token" },
    { key: "oauthScope", label: "OAuth scope", type: "string", help: "For OAuth: the scopes to ask for, separated by spaces" },
    { key: "headers", label: "Extra headers", type: "string", multiline: true, placeholder: "Accept: application/json\nX-Tenant: acme", help: "Sent with every request, one Name: value per line" },
    { key: "test", label: "Test request", type: "string", required: true, default: "GET /", help: "A cheap request that proves the address and sign-in work, for example GET /me" },
    { key: "pagination", label: "Paging", type: "select", default: "None", options: ["None", "Page number", "Offset", "Cursor", "Link header"], help: "How the API returns long lists" },
    { key: "pageParam", label: "Page parameter", type: "string", default: "page", help: "The page, offset or cursor parameter" },
    { key: "pageSizeParam", label: "Page size parameter", type: "string", default: "limit" },
    { key: "pageSize", label: "Page size", type: "number", default: 100 },
    { key: "firstPage", label: "First page number", type: "number", default: 1, help: "For page numbers: 1, or 0 when the API counts from 0" },
    { key: "cursorPath", label: "Next cursor field", type: "string", default: "next", help: "For cursors: where the next cursor is in the response, for example meta.next_cursor" },
    kindSetting("identities", "People (identities)", "A request, then records:, then one field = path per line. Leave empty to skip"),
    kindSetting("accounts", "Accounts", "A request, then records:, then one field = path per line. Leave empty to skip"),
    kindSetting("entitlements", "Entitlements (groups and roles)", "A request, then records:, then one field = path per line. Leave empty to skip"),
    kindSetting("access", "Access (who has which entitlement)", "Use for each: entitlement and {parent.id} to read each group's members. Leave empty to skip"),
    kindSetting("applications", "Applications", "A request, then records:, then one field = path per line. Leave empty to skip"),
    {
      key: "changes",
      label: "Changes it can make",
      type: "string",
      multiline: true,
      placeholder: 'revoke_access = DELETE /groups/{target.entitlement}/members/{target.account}\ndisable_account (repeatable) = PATCH /users/{target.account} {"active": false}',
      help: "One operation = METHOD /path {json body} per line. Runs only once changes are turned on",
    },
    { key: "requestsPerSecond", label: "Requests per second", type: "number", default: 10, help: "At most 50" },
  ],
  auth: {
    type: "bearer",
    token: "{secret.token}",
    fields: [
      { key: "token", label: "Token or API key", optional: true, help: "For a bearer token or an API key" },
      { key: "username", label: "User name", optional: true, help: "For Basic" },
      { key: "password", label: "Password", optional: true, help: "For Basic" },
      { key: "clientId", label: "OAuth client ID", optional: true },
      { key: "clientSecret", label: "OAuth client secret", optional: true },
    ],
  },
  test: { request: { path: "/" } },
  application: "{settings.application}",
  resources: {
    identity: { request: { path: "/" }, fields: { externalId: "id" } },
    account: { request: { path: "/" }, fields: { externalId: "id" } },
    entitlement: { request: { path: "/" }, fields: { externalId: "id", name: "name" } },
    access_grant: { request: { path: "/" }, fields: { externalId: "id", accountExternalId: "account", entitlementExternalId: "entitlement" } },
    application: { request: { path: "/" }, fields: { externalId: "id", name: "name" } },
  },
  write: {
    revoke_access: { request: { method: "DELETE", path: "/{target.entitlement}/{target.account}" } },
    disable_account: { request: { method: "POST", path: "/{target.account}" } },
    grant_access: { request: { method: "POST", path: "/{target.entitlement}/{target.account}" } },
    create_account: { request: { method: "POST", path: "/", body: { email: "{target.email}" } } },
  },
};

import { describe, expect, it } from "vitest";
import { BUILTIN_DEFINITIONS } from "./definitions";
import { DefinitionConnector, httpDriver, parseConnectorConfig, writeCapabilitiesOf, writeIsRepeatable } from "./engine";
import type { FetchLike } from "./http";
import { REST_API_KEY, expandDefinition, parseFieldLine, parseRequestLine } from "./restApi";
import { validateSettings } from "./validate";

const restApi = BUILTIN_DEFINITIONS.find((d) => d.key === REST_API_KEY)!;

/** The settings as validateSettings stores them (defaults filled in). */
function settings(input: Record<string, unknown>) {
  const out = validateSettings(restApi, { baseUrl: "https://api.example.com", application: "Example", ...input });
  expect(out.issues).toEqual([]);
  return out.settings;
}

const ACCOUNTS = "GET /users\nrecords: data\nexternalId = id\nemail = email";

describe("Generic REST API: request lines", () => {
  it("reads the method, path, query and JSON body", () => {
    expect(parseRequestLine("/users")).toEqual({ method: "GET", path: "/users" });
    expect(parseRequestLine('post /search?type=user&role=a&role=b {"active": true}')).toEqual({
      method: "POST",
      path: "/search",
      query: { type: "user", role: ["a", "b"] },
      body: { active: true },
    });
  });

  it("refuses an unknown method and a body that is not JSON", () => {
    expect(() => parseRequestLine("FETCH /users")).toThrow(/method must be/);
    expect(() => parseRequestLine("DELETE /users", ["GET", "POST"])).toThrow(/GET, POST/);
    expect(() => parseRequestLine("POST /users {not json")).toThrow(/JSON body/);
  });
});

describe("Generic REST API: field lines", () => {
  it("maps a path, fallbacks, a template, a constant and transforms", () => {
    expect(parseFieldLine("externalId = id")).toEqual(["externalId", "id"]);
    expect(parseFieldLine("email = mail, upn | lower | trim")).toEqual(["email", { path: ["mail", "upn"], transform: ["lower", "trim"] }]);
    expect(parseFieldLine("displayName = {record.first} {record.last}")).toEqual(["displayName", { template: "{record.first} {record.last}" }]);
    expect(parseFieldLine('identityType = "employee"')).toEqual(["identityType", { value: "employee" }]);
    expect(parseFieldLine("status = active | map:true=active,false=disabled,*=unknown")).toEqual([
      "status",
      { path: "active", transform: [{ map: { true: "active", false: "disabled" }, default: "unknown" }] },
    ]);
    expect(parseFieldLine("title = job.title | replace:Sr.=>Senior | default:none")).toEqual(["title", { path: "job.title", transform: [{ replace: "Sr.", with: "Senior" }], default: "none" }]);
    expect(parseFieldLine('title = {"path": "job.title", "transform": [{"regex": "^(a|b)"}]}')).toEqual(["title", { path: "job.title", transform: [{ regex: "^(a|b)" }] }]);
  });

  it("refuses what it cannot read", () => {
    expect(() => parseFieldLine("no equals sign")).toThrow(/field = path/);
    expect(() => parseFieldLine("email = mail | shout")).toThrow(/not a transform/);
    expect(() => parseFieldLine("email = ")).toThrow(/needs a source/);
  });
});

describe("Generic REST API: building the definition", () => {
  it("leaves every other definition, and a custom one with the same key, as it is", () => {
    const keycloak = BUILTIN_DEFINITIONS.find((d) => d.key === "keycloak")!;
    expect(expandDefinition(keycloak, {}, "builtin").definition).toBe(keycloak);
    expect(expandDefinition(restApi, {}, "custom").definition).toBe(restApi);
  });

  it("reads only the kinds described, with the paging, headers and rate chosen", () => {
    const { definition, issues } = expandDefinition(
      restApi,
      settings({ accounts: ACCOUNTS, headers: "X-Tenant: acme", pagination: "Offset", pageParam: "offset", pageSizeParam: "limit", pageSize: 50, requestsPerSecond: 5 }),
      "builtin",
    );
    expect(issues).toEqual([]);
    expect(Object.keys(definition!.resources)).toEqual(["account"]);
    expect(definition!.resources.account).toMatchObject({
      request: { method: "GET", path: "/users", headers: { "X-Tenant": "acme" } },
      records: "data",
      pagination: { type: "offset", param: "offset", sizeParam: "limit", size: 50 },
      fields: { externalId: "id", email: "email" },
    });
    expect(definition!.test).toEqual({ request: { method: "GET", path: "/", headers: { "X-Tenant": "acme" } } });
    expect(definition!.rateLimitPerSecond).toBe(5);
    expect(definition!.write).toBeUndefined();
  });

  it("asks for only the secrets the chosen sign-in uses", () => {
    const auth = (authType: string, extra: Record<string, unknown> = {}) => expandDefinition(restApi, settings({ accounts: ACCOUNTS, authType, ...extra }), "builtin").definition!.auth;
    expect(auth("None")).toEqual({ type: "none" });
    expect(auth("Basic (user name and password)")).toMatchObject({ type: "basic", fields: [{ key: "username" }, { key: "password" }] });
    expect(auth("Bearer token")).toMatchObject({ type: "bearer", token: "{secret.token}", fields: [{ key: "token" }] });
    expect(auth("API key in a header", { apiKeyName: "X-Auth" })).toMatchObject({ type: "header", name: "X-Auth", value: "{secret.token}" });
    expect(auth("API key in the query string", { apiKeyName: "api_key" })).toMatchObject({ type: "query", name: "api_key" });
    expect(auth("OAuth 2.0 client credentials (HTTP Basic)", { tokenUrl: "https://login.example.com/token", oauthScope: "read" })).toMatchObject({
      type: "oauth2_client_credentials",
      tokenUrl: "{settings.tokenUrl}",
      clientAuth: "basic",
      scope: "read",
      fields: [{ key: "clientId" }, { key: "clientSecret" }],
    });
  });

  it("names the setting and line of every mistake", () => {
    const issues = (input: Record<string, unknown>) => expandDefinition(restApi, settings(input), "builtin").issues;
    expect(issues({})).toEqual([{ path: "settings.accounts", message: expect.stringMatching(/at least one kind/) }]);
    expect(issues({ accounts: "GET /users\nexternalId id" })).toEqual([{ path: "settings.accounts", message: "Accounts: line 2: must be field = path" }]);
    expect(issues({ accounts: "GET /users\nemail = mail" })).toEqual([{ path: "settings.accounts", message: "Accounts: fields.externalId is required" }]);
    expect(issues({ accounts: ACCOUNTS, authType: "OAuth 2.0 client credentials" })).toEqual([{ path: "settings.authType", message: "Sign-in method: OAuth needs the OAuth token address" }]);
    expect(issues({ accounts: ACCOUNTS, authType: "API key in a header", apiKeyName: "X Key" })[0].path).toBe("settings.authType");
    expect(issues({ accounts: ACCOUNTS, headers: "no colon here" })[0].message).toBe("Extra headers: line 1: must be Name: value");
    expect(issues({ accounts: ACCOUNTS, changes: "delete_everything = DELETE /" })[0].message).toMatch(/Changes it can make: line 1: the operation must be/);
    expect(issues({ access: "GET /groups/{parent.id}/members\nfor each: entitlement\nexternalId = id\naccountExternalId = id\nentitlementExternalId = parent.id" })[0].message).toMatch(/there is no entitlement resource/);
  });

  it("holds the built definition to the validator's security rules", () => {
    const issues = (input: Record<string, unknown>) => expandDefinition(restApi, settings(input), "builtin").issues.map((i) => i.message).join("\n");
    // A secret only ever travels in the sign-in, never in a path, header or body.
    expect(issues({ accounts: "GET /users?key={secret.token}\nexternalId = id" })).toMatch(/secrets may only be used in the auth block/);
    // The host is always the connection's own address.
    expect(issues({ accounts: "GET https://elsewhere.example/users\nexternalId = id" })).toMatch(/relative to the base address/);
    expect(issues({ accounts: ACCOUNTS, headers: "Authorization: Bearer x" })).toMatch(/set by the auth block/);
    // A change must say what it changes; {parent.…} needs for each.
    expect(issues({ accounts: ACCOUNTS, changes: "disable_account = POST /users/disable" })).toMatch(/must use \{target.account\}/);
    expect(issues({ accounts: "GET /users/{parent.id}\nexternalId = id" })).toMatch(/not allowed here/);
    expect(issues({ accounts: ACCOUNTS + "\nnickname = nick" })).toMatch(/fields.nickname is not a account field/);
  });

  it("declares the changes listed, repeatable only where said", () => {
    const s = settings({
      accounts: ACCOUNTS,
      entitlements: "GET /groups\nexternalId = id\nname = name",
      changes: 'revoke_access (repeatable) = DELETE /groups/{target.entitlement}/members/{target.account}\ncreate_account = POST /users {"email": "{target.email}"}',
    });
    const def = expandDefinition(restApi, s, "builtin").definition!;
    expect(writeCapabilitiesOf(def)).toMatchObject({ revokeAccess: true, createAccount: true, disableAccount: false, grantAccess: false });
    expect(writeIsRepeatable(def, "revoke_access")).toBe(true);
    expect(writeIsRepeatable(def, "create_account")).toBe(false);
    expect(def.write!.create_account!.request).toEqual({ method: "POST", path: "/users", body: { email: "{target.email}" } });
  });

  it("is what a stored connection runs, from the built-in it names or its stored copy", () => {
    const s = settings({ accounts: ACCOUNTS });
    for (const config of [
      { definition: { key: REST_API_KEY, version: restApi.version, origin: "builtin" }, settings: s },
      { definition: { key: REST_API_KEY, version: restApi.version, origin: "builtin" }, manifest: restApi, settings: s },
    ]) {
      const { def } = parseConnectorConfig(config);
      expect(Object.keys(def.resources)).toEqual(["account"]);
    }
    expect(() => parseConnectorConfig({ definition: { key: REST_API_KEY, version: restApi.version, origin: "builtin" }, settings: settings({}) })).toThrow(/at least one kind/);
  });
});

describe("Generic REST API: a sync", () => {
  it("signs in with OAuth, follows cursors, keeps matching records and maps each one", async () => {
    const calls: { url: URL; init: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      const u = new URL(url);
      calls.push({ url: u, init: init as never });
      if (u.pathname === "/oauth/token") return new Response(JSON.stringify({ access_token: "tok1", expires_in: 300 }), { status: 200 });
      if (u.pathname === "/api/people") {
        const page = u.searchParams.get("cursor");
        const body = !page
          ? { items: [{ id: 1, name: { first: "Ada", last: "Lovelace" }, mail: "ADA@EXAMPLE.COM", active: true }], meta: { next: "c2" } }
          : { items: [{ id: 2, name: { first: "Old", last: "Account" }, upn: "old@example.com", active: false, deleted: true }], meta: { next: null } };
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    };
    const s = settings({
      baseUrl: "https://api.example.com",
      tokenUrl: "https://login.example.com/oauth/token",
      authType: "OAuth 2.0 client credentials",
      oauthScope: "people.read",
      pagination: "Cursor",
      pageParam: "cursor",
      pageSizeParam: "size",
      pageSize: 1,
      cursorPath: "meta.next",
      identities: [
        "GET /api/people?include=manager",
        "records: items",
        "where: deleted != true",
        "externalId = id | string",
        "displayName = {record.name.first} {record.name.last}",
        "email = mail, upn | lower",
        "status = active | map:true=active,false=inactive",
        'identityType = "employee"',
      ].join("\n"),
    });
    const connector = new DefinitionConnector({ http: httpDriver(fetchImpl) });
    await connector.authenticate({ definition: { key: REST_API_KEY, version: restApi.version, origin: "builtin" }, settings: s }, JSON.stringify({ clientId: "cid", clientSecret: "csecret" }));
    const records = await connector.importKind("identity");

    expect(records.map((r) => r.normalized)).toEqual([{ externalId: "1", displayName: "Ada Lovelace", email: "ada@example.com", status: "active", identityType: "employee" }]);
    const token = calls[0];
    expect(token.url.origin).toBe("https://login.example.com");
    expect(token.init.body).toContain("scope=people.read");
    const reads = calls.filter((c) => c.url.pathname === "/api/people");
    expect(reads).toHaveLength(2);
    expect(reads[1].url.searchParams.get("cursor")).toBe("c2");
    expect(reads[0].url.searchParams.get("include")).toBe("manager");
    for (const r of reads) expect(r.init.headers?.Authorization).toBe("Bearer tok1");
  });

  it("reports a failed request truthfully", async () => {
    const fetchImpl: FetchLike = async () => new Response("{}", { status: 403 });
    const connector = new DefinitionConnector({ http: httpDriver(fetchImpl) });
    await connector.authenticate({ definition: { key: REST_API_KEY, version: restApi.version, origin: "builtin" }, settings: settings({ accounts: ACCOUNTS, test: "GET /me" }) }, JSON.stringify({ token: "t" }));
    expect(await connector.testConnection()).toEqual({ ok: false, message: "GET /me failed: HTTP 403" });
    await expect(connector.importKind("account")).rejects.toThrow("GET /users failed: HTTP 403");
  });
});

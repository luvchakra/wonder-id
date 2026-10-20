import {
  DEFINITION_WRITE_OPERATIONS,
  RESOURCE_KINDS,
  TRANSFORMS,
  type AuthSpec,
  type ConnectorDefinition,
  type DefinitionIssue,
  type DefinitionWriteOperation,
  type FieldMapping,
  type HttpRequestSpec,
  type Pagination,
  type RecordFilter,
  type ResourceKind,
  type ResourceSpec,
  type SecretField,
  type Transform,
  type WriteSpec,
} from "./types";
import { validateDefinition } from "./validate";

/**
 * Fix-list item 19: the Generic REST API connection type
 * (definitions/rest-api.ts). Its requests, records and field mappings are
 * the connection's own settings, written as short lines; this turns them
 * into an ordinary connector definition, which validateDefinition then
 * holds to every rule a built-in meets (relative paths, no secret outside
 * the auth block, writes that name their target, safe patterns). Nothing
 * here calls out: the engine and the gateway run the result as they run
 * any other definition.
 *
 * A kind's setting:
 *
 *   GET /api/users?status=active          the request (method optional; a JSON body may follow the path)
 *   records: data.items                   where the list is in the response (a, b tries each)
 *   for each: entitlement                 run once per entitlement, with {parent.…} in the path
 *   unwind: members                       one record per item of this list field
 *   total: meta.total                     the count the API reports (or header:X-Total-Count)
 *   where: status != deleted              keep only matching records (=, !=, exists, missing)
 *   pagination: none                      this request is not paged
 *   externalId = id                       a canonical field = a field path
 *   email = mail, userPrincipalName | lower   paths tried in order, then transforms
 *   displayName = {record.first} {record.last}  a template
 *   identityType = "employee"             a constant
 *   status = active | map:true=active,false=disabled,*=active
 *   title = {"path": "job.title", "transform": ["trim"]}   a mapping in the definition's JSON form
 */

export const REST_API_KEY = "rest-api";

const KIND_SETTINGS: [string, ResourceKind][] = [
  ["identities", "identity"],
  ["accounts", "account"],
  ["entitlements", "entitlement"],
  ["access", "access_grant"],
  ["applications", "application"],
];

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const HEADER_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;

type Settings = Record<string, string | number | boolean>;

class LineError extends Error {}

const text = (settings: Settings, key: string): string => (typeof settings[key] === "string" ? (settings[key] as string) : "");

/** Content lines with their 1-based numbers; blank lines and # comments are skipped. */
function contentLines(value: string): { line: number; text: string }[] {
  return value
    .split(/\r?\n/)
    .map((t, i) => ({ line: i + 1, text: t.trim() }))
    .filter((l) => l.text && !l.text.startsWith("#"));
}

/** A scalar written in a setting: true, false, null, a number, a quoted text, or the text itself. */
function scalar(raw: string): string | number | boolean | null {
  const t = raw.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const q = /^"(.*)"$|^'(.*)'$/.exec(t);
  return q ? (q[1] ?? q[2]) : t;
}

/** `[METHOD] /path[?query] [JSON body]`. */
export function parseRequestLine(line: string, methods: readonly string[] = METHODS): HttpRequestSpec {
  const m = /^(?:([A-Za-z]+)\s+)?(\S+)(?:\s+([\s\S]+))?$/.exec(line.trim());
  if (!m) throw new LineError("must be a request: METHOD /path");
  const method = (m[1] ?? "GET").toUpperCase();
  if (!methods.includes(method)) throw new LineError(`the method must be ${methods.join(", ")}`);
  const q = m[2].indexOf("?");
  const path = q < 0 ? m[2] : m[2].slice(0, q);
  const query = q < 0 ? "" : m[2].slice(q + 1);
  const spec: HttpRequestSpec = { method: method as HttpRequestSpec["method"], path };
  if (query) {
    const params: Record<string, string | string[]> = {};
    for (const [k, v] of new URLSearchParams(query)) {
      const prior = params[k];
      params[k] = prior === undefined ? v : Array.isArray(prior) ? [...prior, v] : [prior, v];
    }
    spec.query = params;
  }
  if (m[3]) {
    try {
      spec.body = JSON.parse(m[3]);
    } catch {
      throw new LineError("the text after the path must be a JSON body");
    }
  }
  return spec;
}

function parseTransform(raw: string): { transform?: Transform; default?: string | number | boolean | null } {
  const t = raw.trim();
  if ((TRANSFORMS as readonly string[]).includes(t)) return { transform: t as Transform };
  const m = /^([a-zA-Z]+):([\s\S]*)$/.exec(t);
  if (!m) throw new LineError(`"${t}" is not a transform (${TRANSFORMS.join(", ")}, map:, prefix:, contains:, replace:, regex:, default:)`);
  const [, name, arg] = m;
  switch (name) {
    case "default":
      return { default: scalar(arg) };
    case "prefix":
      return { transform: { prefix: arg } };
    case "contains":
      return { transform: { contains: arg } };
    case "regex":
      return { transform: { regex: arg } };
    case "replace": {
      const [from, to] = arg.split("=>");
      if (to === undefined) throw new LineError("replace: is written replace:old=>new");
      return { transform: { replace: from, with: to } };
    }
    case "map": {
      const map: Record<string, string | number | boolean | null> = {};
      let fallback: string | number | boolean | null | undefined;
      for (const pair of arg.split(",")) {
        const at = pair.indexOf("=");
        if (at < 1) throw new LineError("map: is written map:from=to,from=to,*=otherwise");
        const from = pair.slice(0, at).trim();
        const to = scalar(pair.slice(at + 1));
        if (from === "*") fallback = to;
        else map[from] = to;
      }
      return { transform: fallback === undefined ? { map } : { map, default: fallback } };
    }
    default:
      throw new LineError(`"${name}:" is not a transform`);
  }
}

/** `field = source | transform | …`. */
export function parseFieldLine(line: string): [string, FieldMapping] {
  const at = line.indexOf("=");
  if (at < 1) throw new LineError("must be field = path");
  const field = line.slice(0, at).trim();
  const rest = line.slice(at + 1).trim();
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(field)) throw new LineError(`"${field}" is not a field name`);
  if (!rest) throw new LineError(`${field} needs a source`);
  if (rest.startsWith("{")) {
    try {
      const json = JSON.parse(rest);
      if (json && typeof json === "object" && !Array.isArray(json)) return [field, json as FieldMapping];
    } catch {
      /* a template such as {record.first} {record.last} */
    }
  }
  const [source, ...pipes] = rest.split("|").map((s) => s.trim());
  if (!source) throw new LineError(`${field} needs a source`);
  const mapping: Exclude<FieldMapping, string> = {};
  const quoted = /^"(.*)"$|^'(.*)'$/.exec(source);
  if (quoted) mapping.value = quoted[1] ?? quoted[2];
  else if (source.includes("{")) mapping.template = source;
  else {
    const paths = source.split(",").map((p) => p.trim());
    if (paths.some((p) => !p)) throw new LineError(`${field}: a path is empty`);
    mapping.path = paths.length === 1 ? paths[0] : paths;
  }
  const transforms: Transform[] = [];
  for (const p of pipes) {
    const t = parseTransform(p);
    if (t.transform !== undefined) transforms.push(t.transform);
    if ("default" in t) mapping.default = t.default;
  }
  if (transforms.length) mapping.transform = transforms;
  if (mapping.path !== undefined && transforms.length === 0 && mapping.default === undefined && typeof mapping.path === "string") return [field, mapping.path];
  return [field, mapping];
}

function parseWhere(arg: string): RecordFilter {
  const exists = /^(\S+)\s+(exists|missing)$/.exec(arg);
  if (exists) return { path: exists[1], exists: exists[2] === "exists" };
  const m = /^(\S+)\s*(!=|=)\s*([\s\S]+)$/.exec(arg);
  if (!m) throw new LineError("where: is written where: path = value, path != value, path exists or path missing");
  return m[2] === "=" ? { path: m[1], equals: scalar(m[3]) } : { path: m[1], notEquals: scalar(m[3]) };
}

const DIRECTIVE_RE = /^(records|for each|foreach|unwind|total|where|pagination)\s*:\s*(.*)$/i;

/** One kind's setting as a resource. Errors carry the line they are on. */
export function parseResource(value: string, pagination: Pagination): ResourceSpec {
  const lines = contentLines(value);
  if (lines.length === 0) throw new LineError("is empty");
  const at = (l: { line: number }, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      if (err instanceof LineError) throw new LineError(`line ${l.line}: ${err.message}`);
      throw err;
    }
  };
  let spec: ResourceSpec = { fields: {} };
  at(lines[0], () => {
    spec = { request: parseRequestLine(lines[0].text, ["GET", "POST"]), pagination, fields: {} };
  });
  const where: RecordFilter[] = [];
  for (const l of lines.slice(1)) {
    at(l, () => {
      const d = DIRECTIVE_RE.exec(l.text);
      if (d) {
        const name = d[1].toLowerCase();
        const arg = d[2].trim();
        if (name === "records") {
          const paths = arg.split(",").map((p) => p.trim());
          spec.records = paths.length === 1 ? paths[0] : paths;
        } else if (name === "for each" || name === "foreach") {
          const kind = KIND_SETTINGS.find(([key, k]) => arg === k || arg === key || `${arg}s` === key)?.[1];
          if (!kind || !(RESOURCE_KINDS as readonly string[]).includes(kind)) throw new LineError(`for each: must be identity, account, entitlement or application`);
          spec.forEach = kind;
        } else if (name === "unwind") spec.unwind = arg;
        else if (name === "total") spec.total = arg;
        else if (name === "where") where.push(parseWhere(arg));
        else if (name === "pagination") {
          if (arg.toLowerCase() !== "none") throw new LineError("pagination: can only be none here; choose the paging in the connection's settings");
          spec.pagination = { type: "none" };
        }
        return;
      }
      const [field, mapping] = parseFieldLine(l.text);
      if (field in spec.fields) throw new LineError(`${field} is mapped twice`);
      spec.fields[field] = mapping;
    });
  }
  if (where.length) spec.where = where;
  return spec;
}

function paginationOf(settings: Settings): Pagination {
  const size = Number(settings.pageSize ?? 100);
  const param = text(settings, "pageParam");
  const sizeParam = text(settings, "pageSizeParam") || undefined;
  switch (settings.pagination) {
    case "Page number":
      return { type: "page", param, ...(sizeParam ? { sizeParam } : {}), size, start: Number(settings.firstPage ?? 1) };
    case "Offset":
      return { type: "offset", param, sizeParam: sizeParam ?? "", size };
    case "Cursor":
      return { type: "cursor", param, from: text(settings, "cursorPath"), ...(sizeParam ? { sizeParam, size } : {}) };
    case "Link header":
      return { type: "link_header", ...(sizeParam ? { sizeParam, size } : {}) };
    default:
      return { type: "none" };
  }
}

const SECRET: Record<string, SecretField> = {
  token: { key: "token", label: "Token or API key" },
  username: { key: "username", label: "User name" },
  password: { key: "password", label: "Password" },
  clientId: { key: "clientId", label: "OAuth client ID" },
  clientSecret: { key: "clientSecret", label: "OAuth client secret" },
};

/** The sign-in the connection chose. Only the secrets it uses are asked for. */
function authOf(settings: Settings): AuthSpec {
  const name = text(settings, "apiKeyName");
  const keyName = () => {
    if (!NAME_RE.test(name)) throw new LineError("must be letters, digits, _, . or -");
    return name;
  };
  const choice = String(settings.authType ?? "Bearer token");
  switch (choice) {
    case "None":
      return { type: "none" };
    case "Basic (user name and password)":
      return { type: "basic", username: "{secret.username}", password: "{secret.password}", fields: [SECRET.username, SECRET.password] };
    case "Bearer token":
      return { type: "bearer", token: "{secret.token}", fields: [SECRET.token] };
    case "API key in a header":
      return { type: "header", name: keyName(), value: "{secret.token}", fields: [SECRET.token] };
    case "API key in the query string":
      return { type: "query", name: keyName(), value: "{secret.token}", fields: [SECRET.token] };
    case "OAuth 2.0 client credentials":
    case "OAuth 2.0 client credentials (HTTP Basic)": {
      if (!text(settings, "tokenUrl")) throw new LineError("OAuth needs the OAuth token address");
      const scope = text(settings, "oauthScope");
      return {
        type: "oauth2_client_credentials",
        tokenUrl: "{settings.tokenUrl}",
        clientId: "{secret.clientId}",
        clientSecret: "{secret.clientSecret}",
        clientAuth: choice.endsWith("(HTTP Basic)") ? "basic" : "body",
        ...(scope ? { scope } : {}),
        fields: [SECRET.clientId, SECRET.clientSecret],
      };
    }
    default:
      throw new LineError(`"${choice}" is not a sign-in method`);
  }
}

function headersOf(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of contentLines(value)) {
    const at = l.text.indexOf(":");
    const name = at > 0 ? l.text.slice(0, at).trim() : "";
    if (!HEADER_RE.test(name)) throw new LineError(`line ${l.line}: must be Name: value`);
    out[name] = l.text.slice(at + 1).trim();
  }
  return out;
}

/** `operation [(repeatable)] = METHOD /path [JSON body]`, one per line. */
function writesOf(value: string): Partial<Record<DefinitionWriteOperation, WriteSpec>> {
  const out: Partial<Record<DefinitionWriteOperation, WriteSpec>> = {};
  for (const l of contentLines(value)) {
    const m = /^([a-z_]+)\s*(\(repeatable\))?\s*=\s*([\s\S]+)$/.exec(l.text);
    if (!m) throw new LineError(`line ${l.line}: must be operation = METHOD /path`);
    const op = m[1] as DefinitionWriteOperation;
    if (!DEFINITION_WRITE_OPERATIONS.includes(op)) throw new LineError(`line ${l.line}: the operation must be ${DEFINITION_WRITE_OPERATIONS.join(", ")}`);
    if (out[op]) throw new LineError(`line ${l.line}: ${op} is listed twice`);
    let request: HttpRequestSpec;
    try {
      request = parseRequestLine(m[3], ["POST", "PUT", "PATCH", "DELETE"]);
    } catch (err) {
      throw err instanceof LineError ? new LineError(`line ${l.line}: ${err.message}`) : err;
    }
    out[op] = m[2] ? { request, repeatable: true } : { request };
  }
  return out;
}

const LABEL: Record<string, string> = {
  authType: "Sign-in method",
  apiKeyName: "API key name",
  headers: "Extra headers",
  test: "Test request",
  pagination: "Paging",
  identities: "People (identities)",
  accounts: "Accounts",
  entitlements: "Entitlements (groups and roles)",
  access: "Access (who has which entitlement)",
  applications: "Applications",
  changes: "Changes it can make",
  requestsPerSecond: "Requests per second",
};

/** A validator issue on the built definition, named after the setting it came from. */
function settingFor(path: string): string {
  if (/\.pagination\b/.test(path)) return "pagination";
  const kind = /^resources\.([a-z_]+)/.exec(path)?.[1];
  if (kind) return KIND_SETTINGS.find(([, k]) => k === kind)?.[0] ?? "accounts";
  if (path.startsWith("auth")) return "authType";
  if (path.startsWith("test")) return "test";
  if (path.startsWith("write")) return "changes";
  if (path.startsWith("rateLimitPerSecond")) return "requestsPerSecond";
  return "pagination";
}

/**
 * The definition a connection runs. For a Generic REST API connection made
 * from the built-in type, the one built from its settings; for every other
 * definition, the definition itself.
 */
export function expandDefinition(
  def: ConnectorDefinition,
  settings: Settings,
  origin: "builtin" | "custom" | undefined,
): { definition: ConnectorDefinition | null; issues: DefinitionIssue[] } {
  if (def.key !== REST_API_KEY || origin !== "builtin") return { definition: def, issues: [] };
  const issues: DefinitionIssue[] = [];
  const attempt = <T>(key: string, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (err) {
      if (!(err instanceof LineError)) throw err;
      issues.push({ path: `settings.${key}`, message: `${LABEL[key] ?? key}: ${err.message}` });
      return undefined;
    }
  };

  const auth = attempt("authType", () => authOf(settings));
  const headers = attempt("headers", () => headersOf(text(settings, "headers"))) ?? {};
  const withHeaders = (r: HttpRequestSpec): HttpRequestSpec => (Object.keys(headers).length ? { ...r, headers: { ...headers, ...(r.headers ?? {}) } } : r);
  const test = attempt("test", () => parseRequestLine(text(settings, "test") || "GET /", ["GET", "POST"]));
  const pagination = paginationOf(settings);
  const resources: ConnectorDefinition["resources"] = {};
  for (const [key, kind] of KIND_SETTINGS) {
    const value = text(settings, key);
    if (!value.trim()) continue;
    const spec = attempt(key, () => parseResource(value, pagination));
    if (spec) resources[kind] = { ...spec, request: withHeaders(spec.request!) };
  }
  if (Object.keys(resources).length === 0 && !issues.some((i) => KIND_SETTINGS.some(([k]) => i.path === `settings.${k}`))) {
    issues.push({ path: "settings.accounts", message: "Describe at least one kind of record to read (people, accounts, entitlements, access or applications)" });
  }
  const write = attempt("changes", () => writesOf(text(settings, "changes"))) ?? {};
  if (issues.length || !auth || !test) return { definition: null, issues };

  const built: ConnectorDefinition = {
    ...def,
    auth,
    test: { request: withHeaders(test) },
    resources,
    rateLimitPerSecond: Number(settings.requestsPerSecond ?? 10),
  };
  delete built.write;
  if (Object.keys(write).length) {
    built.write = Object.fromEntries(Object.entries(write).map(([op, w]) => [op, { ...w, request: withHeaders(w.request!) }]));
  }
  const checked = validateDefinition(built);
  if (!checked.definition) {
    return {
      definition: null,
      issues: checked.issues.map((i) => {
        const key = settingFor(i.path);
        // "resources.account.fields.foo" reads as "fields.foo" under the Accounts setting.
        const where = i.path.replace(/^resources\.[a-z_]+(\[\d+\])?\./, "").replace(/^write\./, "");
        return { path: `settings.${key}`, message: `${LABEL[key]}: ${where} ${i.message}` };
      }),
    };
  }
  return { definition: checked.definition, issues: [] };
}

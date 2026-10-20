import "server-only";

import net from "node:net";
import { Client } from "pg";
import { Connection as TdsConnection, Request as TdsRequest } from "tedious";
import oracledb from "oracledb";
import mysql from "mysql2/promise";
import type { DriverFactory } from "../engine";
import { fillTemplate } from "../mapping";
import { resolveSafeHost } from "./net";
import { addressOf } from "../address";
import { SQL_DIALECTS, querySettingOf, sqlDialectOf, sqlQueryIssues, type SqlDialect } from "../sqlDialects";

/**
 * The sql driver: PostgreSQL, Microsoft SQL Server, Oracle Database and
 * MySQL/MariaDB, chosen by the address's scheme (sqlDialects.ts). For
 * every one: TLS with certificate verification always (a custom CA via
 * settings.caCertificate), one read-only transaction per query (or, on SQL
 * Server, which has none, a transaction that is always rolled back) with a
 * statement timeout, and a hard row limit. validate.ts has already refused
 * anything but a single SELECT/WITH, and the statement is checked again
 * here before it runs.
 */

type Rows = Record<string, unknown>[];
type SqlSession = { readOnly(query: string, max: number): Promise<Rows>; close(): Promise<void> };
type Target = {
  host: string;
  /** The vetted address to connect to (resolveSafeHost). */
  address: string;
  /** The name TLS verifies the certificate against; undefined for an IP literal. */
  servername: string | undefined;
  port: number;
  database: string;
  user: string;
  password: string;
  ca: string | undefined;
  /** Oracle only: the PEM wallet and its password, from the secrets. */
  wallet: string | undefined;
  walletPassword: string | undefined;
  timeoutMs: number;
};

const CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 30_000;

/** settings.timeoutSeconds, between 5 and 120 seconds; 30 otherwise. */
function timeoutOf(settings: Record<string, unknown>): number {
  const s = Number(settings.timeoutSeconds);
  return Number.isFinite(s) && s >= 5 && s <= 120 ? Math.floor(s * 1000) : DEFAULT_TIMEOUT_MS;
}

/** An optional secret field named as `{secret.<key>}` (validate.ts allows nothing else); undefined when left empty. */
function optionalSecret(template: string | undefined, secrets: Record<string, string>): string | undefined {
  const key = /^\{secret\.([a-zA-Z0-9_]+)\}$/.exec(template ?? "")?.[1];
  return (key && secrets[key]) || undefined;
}

const limitOf =(max: number) => Math.max(1, Math.floor(max));
const statementOf = (query: string) => query.trim().replace(/;\s*$/, "");

export const sqlDriver: DriverFactory = async (def, settings, secrets) => {
  // The address the Gateway checked against the allowed hosts (WID-H05).
  const url = new URL(String(addressOf(def, settings)));
  const dialect = sqlDialectOf(url);
  if (!dialect || (def.sqlDialects && !def.sqlDialects.includes(dialect))) throw new Error(`${url.protocol}// is not a database address this connector reads`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const address = await resolveSafeHost(url.hostname);
  const auth = def.auth as Extract<typeof def.auth, { type: "sql_password" }>;
  const scope = { settings, secret: secrets };
  const target: Target = {
    host,
    address,
    servername: net.isIP(host) ? undefined : host,
    port: Number(url.port || SQL_DIALECTS[dialect].port),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    user: fillTemplate(auth.username, scope),
    password: fillTemplate(auth.password, scope),
    ca: typeof settings.caCertificate === "string" && settings.caCertificate.includes("BEGIN CERTIFICATE") ? settings.caCertificate : undefined,
    timeoutMs: timeoutOf(settings),
    wallet: optionalSecret(auth.wallet, secrets)?.trim() || undefined,
    walletPassword: optionalSecret(auth.walletPassword, secrets),
  };
  const session = await OPEN[dialect](target);

  /** The statement to run: the definition's own, or the one the organization entered for the custom-query connector. */
  function statement(query: string | undefined): string | null {
    const key = querySettingOf(query);
    const text = key ? String(settings[key] ?? "").trim() : (query ?? "");
    if (!text) return null;
    const issues = sqlQueryIssues(text);
    if (issues.length > 0) throw new Error(`The query ${issues[0]}`);
    return text;
  }

  return {
    async test() {
      const query = statement(def.test?.query);
      if (!query) throw new Error("This definition has no test query");
      await session.readOnly(query, 1);
    },
    async fetch(resource, _scope, max) {
      if (!resource.query) throw new Error("This resource has no query");
      const query = statement(resource.query);
      // A custom-query kind left empty reads nothing.
      return query ? session.readOnly(query, max) : [];
    },
    async close() {
      await session.close().catch(() => undefined);
    },
  };
};

const OPEN: Record<SqlDialect, (t: Target) => Promise<SqlSession>> = {
  postgres: openPostgres,
  sqlserver: openSqlServer,
  oracle: openOracle,
  mysql: openMysql,
};

async function openPostgres(t: Target): Promise<SqlSession> {
  const client = new Client({
    host: t.address,
    port: t.port,
    database: t.database || "postgres",
    user: t.user,
    password: t.password,
    ssl: { rejectUnauthorized: true, servername: t.servername, ca: t.ca },
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: t.timeoutMs,
    query_timeout: t.timeoutMs + 5_000,
    application_name: "WonderID",
  });
  await client.connect();
  return {
    async readOnly(query, max) {
      await client.query("BEGIN READ ONLY");
      try {
        const res = await client.query(`SELECT * FROM (${statementOf(query)}) AS wonderid_source LIMIT ${limitOf(max)}`);
        return res.rows as Rows;
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
      }
    },
    close: () => client.end(),
  };
}

/**
 * SQL Server: TDS over TLS (encrypt, certificate and name verified), with
 * the read-only application intent. T-SQL has no read-only transaction and
 * no way to wrap a CTE or an ORDER BY in a derived table, so the statement
 * runs as written, capped by SET ROWCOUNT, inside a transaction that is
 * always rolled back.
 */
async function openSqlServer(t: Target): Promise<SqlSession> {
  const connection = new TdsConnection({
    server: t.address,
    authentication: { type: "default", options: { userName: t.user, password: t.password } },
    options: {
      port: t.port,
      database: t.database || undefined,
      encrypt: true,
      trustServerCertificate: false,
      serverName: t.servername,
      cryptoCredentialsDetails: t.ca ? { ca: t.ca } : undefined,
      readOnlyIntent: true,
      connectTimeout: CONNECT_TIMEOUT_MS,
      requestTimeout: t.timeoutMs,
      appName: "WonderID",
    },
  });
  await new Promise<void>((resolve, reject) => {
    connection.on("error", () => undefined);
    connection.connect((err) => (err ? reject(err) : resolve()));
  });
  const run = (sql: string) =>
    new Promise<Rows>((resolve, reject) => {
      const rows: Rows = [];
      const request = new TdsRequest(sql, (err) => (err ? reject(err) : resolve(rows)));
      request.on("row", (columns: { metadata: { colName: string }; value: unknown }[]) => {
        const row: Record<string, unknown> = {};
        for (const c of columns) row[c.metadata.colName] = c.value;
        rows.push(row);
      });
      connection.execSqlBatch(request);
    });
  return {
    async readOnly(query, max) {
      await run(`SET ROWCOUNT ${limitOf(max)}; BEGIN TRANSACTION`);
      try {
        return await run(statementOf(query));
      } finally {
        await run("IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; SET ROWCOUNT 0").catch(() => undefined);
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        connection.on("end", () => resolve());
        connection.close();
      }),
  };
}

// Text columns arrive as text, not as LOB handles.
oracledb.fetchAsString = [oracledb.CLOB, oracledb.NCLOB];

/**
 * Oracle Database: the thin driver over TCPS, the certificate verified
 * against the host name, the address's path being the service name. The
 * thin driver opens its own socket by host name, so the host is vetted just
 * before. Column names arrive in lower case (Oracle folds unquoted names to
 * upper case), so definitions read the same field names on every database.
 * The thin driver takes a private CA only inside a PEM wallet (with a key
 * and certificate), so a listener signed by a private CA needs the wallet
 * secret rather than the CA certificate setting.
 */
async function openOracle(t: Target): Promise<SqlSession> {
  if (!t.database) throw new Error("The address needs the service name: oracle://host:2484/service");
  if (t.ca && !t.wallet) throw new Error("Oracle takes a private CA in a wallet (ewallet.pem), not as a CA certificate: enter the wallet instead");
  const connection = await oracledb.getConnection({
    user: t.user,
    password: t.password,
    connectString: `tcps://${t.servername ?? t.address}:${t.port}/${t.database}`,
    walletContent: t.wallet,
    walletPassword: t.walletPassword,
    connectTimeout: CONNECT_TIMEOUT_MS / 1000,
    transportConnectTimeout: CONNECT_TIMEOUT_MS / 1000,
  });
  connection.callTimeout = t.timeoutMs;
  return {
    async readOnly(query, max) {
      await connection.execute("SET TRANSACTION READ ONLY");
      try {
        const res = await connection.execute<Record<string, unknown>>(`SELECT * FROM (${statementOf(query)}) wonderid_source WHERE ROWNUM <= ${limitOf(max)}`, [], {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          maxRows: limitOf(max),
        });
        return (res.rows ?? []).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v])));
      } finally {
        await connection.rollback().catch(() => undefined);
      }
    },
    close: () => connection.close(),
  };
}

/**
 * MySQL and MariaDB: TLS required, the certificate verified against the
 * host name while the socket goes to the vetted address. Large numbers
 * arrive as text so nothing is rounded.
 */
async function openMysql(t: Target): Promise<SqlSession> {
  const connection = await mysql.createConnection({
    host: t.servername ?? t.address,
    port: t.port,
    stream: () => net.connect({ host: t.address, port: t.port }),
    user: t.user,
    password: t.password,
    database: t.database || undefined,
    ssl: { rejectUnauthorized: true, verifyIdentity: t.servername !== undefined, ca: t.ca },
    connectTimeout: CONNECT_TIMEOUT_MS,
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  return {
    async readOnly(query, max) {
      await connection.query("START TRANSACTION READ ONLY");
      try {
        const [rows] = await connection.query({ sql: `SELECT * FROM (${statementOf(query)}) AS wonderid_source LIMIT ${limitOf(max)}`, timeout: t.timeoutMs });
        return rows as Rows;
      } finally {
        await connection.query("ROLLBACK").catch(() => undefined);
      }
    },
    close: () => connection.end(),
  };
}

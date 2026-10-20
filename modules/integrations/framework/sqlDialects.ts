/**
 * The databases the sql driver speaks, chosen by the address's scheme:
 * postgres://host:5432/db, sqlserver://host:1433/db, oracle://host:2484/service,
 * mysql://host:3306/db. Every one connects over verified TLS only.
 */
export const SQL_DIALECTS = {
  postgres: { schemes: ["postgres:", "postgresql:"], port: 5432, label: "PostgreSQL" },
  sqlserver: { schemes: ["sqlserver:", "mssql:"], port: 1433, label: "Microsoft SQL Server" },
  oracle: { schemes: ["oracle:"], port: 2484, label: "Oracle Database" },
  mysql: { schemes: ["mysql:", "mariadb:"], port: 3306, label: "MySQL or MariaDB" },
} as const;
export type SqlDialect = keyof typeof SQL_DIALECTS;

export const SQL_SCHEMES: readonly string[] = Object.values(SQL_DIALECTS).flatMap((d) => d.schemes);

/** The dialect of a database address, or null when the scheme is not one WonderID speaks. */
export function sqlDialectOf(address: string | URL | null | undefined): SqlDialect | null {
  if (!address) return null;
  let protocol: string;
  try {
    protocol = (address instanceof URL ? address : new URL(address)).protocol.toLowerCase();
  } catch {
    return null;
  }
  for (const [dialect, d] of Object.entries(SQL_DIALECTS)) if ((d.schemes as readonly string[]).includes(protocol)) return dialect as SqlDialect;
  return null;
}

/**
 * A resource whose query is exactly `{settings.<key>}` takes its statement
 * from that setting (the custom-query connector). The organization's SQL is
 * then checked by sqlQueryIssues() when the connection is saved and again
 * before every run.
 */
export function querySettingOf(query: string | undefined): string | null {
  const m = /^\{settings\.([a-zA-Z][a-zA-Z0-9_]{0,40})\}$/.exec(query?.trim() ?? "");
  return m ? m[1] : null;
}

const WRITES = /\b(insert|update|delete|merge|upsert|truncate|drop|alter|create|grant|revoke|deny|copy|call|do|set|reset|lock|vacuum|refresh|listen|notify|exec|execute|declare|begin|commit|rollback|savepoint|use|into|load|handler|prepare|deallocate|shutdown|kill|backup|restore|dbcc|bulk|reconfigure|purge|analyze|flashback|rename)\b/i;

/** Functions that reach the file system, the network, another server or the clock, in any of the dialects. */
const FUNCTIONS =
  /\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_import|lo_export|dblink\w*|pg_sleep\w*|pg_terminate_backend|pg_cancel_backend|set_config|xp_\w+|sp_\w+|openrowset|opendatasource|openquery|openxml|waitfor|dbms_\w+|utl_\w+|httpuritype|sys\.dbms_\w+|load_file|sleep|benchmark|get_lock|release_lock|sys_exec|sys_eval)\b/i;

/**
 * Why a statement may not run, or nothing: one read-only SELECT (or
 * WITH … SELECT), no templates, nothing that writes, changes the session
 * or reaches outside the database. The driver also runs it in a read-only
 * transaction (or rolls it back) under a timeout and a row limit.
 */
export function sqlQueryIssues(q: unknown): string[] {
  if (typeof q !== "string" || q.trim() === "") return ["is required for the sql driver"];
  if (q.length > 10_000) return ["is longer than 10 000 characters"];
  const issues: string[] = [];
  const body = q.trim().replace(/;\s*$/, "");
  // Quoting the checks below could read differently from the database is refused outright:
  // backslash escapes (MySQL, PostgreSQL E''), dollar quotes (PostgreSQL) and q'[…]' (Oracle).
  if (body.includes("\\")) issues.push("must not contain a backslash");
  if (/\$[A-Za-z_]*\$/.test(body)) issues.push("must not use dollar quoting");
  if (/(^|[^A-Za-z0-9_])n?q'/i.test(body)) issues.push("must not use q'…' quoting");
  // Literals and quoted names are blanked, so the checks below read only code. A bracketed
  // name (SQL Server) is blanked only when it holds no parentheses, so no call can hide in one.
  const code = body.replace(/'(?:[^']|'')*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, "``").replace(/\[[A-Za-z0-9_ $#@.-]*\]/g, "[]");
  // Comments could hide a second statement from the checks below.
  if (/--|\/\*|#/.test(code)) issues.push("must not contain comments");
  if (code.includes(";")) issues.push("must be a single statement");
  if (!/^\(*\s*(select|with)\b/i.test(code)) issues.push("must be a SELECT (or WITH … SELECT) statement");
  const write = WRITES.exec(code);
  if (write) issues.push(`may only read (found ${write[1].toUpperCase()})`);
  const fn = FUNCTIONS.exec(code);
  if (fn) issues.push(`uses ${fn[1]}, which is not allowed`);
  if (/\bfor\s+(update|share)\b/i.test(code)) issues.push("may not lock rows (FOR UPDATE)");
  if (/\{[a-zA-Z]+\.[^}]*\}/.test(code)) issues.push("may not use templates");
  return issues;
}

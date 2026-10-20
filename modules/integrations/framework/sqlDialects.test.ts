import { describe, expect, it } from "vitest";
import { querySettingOf, sqlDialectOf, sqlQueryIssues } from "./sqlDialects";
import { BUILTIN_DEFINITIONS } from "./definitions";
import { specsOf } from "./engine";

describe("sqlDialectOf", () => {
  it("picks the database from the address's scheme", () => {
    expect(sqlDialectOf("postgres://h/db")).toBe("postgres");
    expect(sqlDialectOf("postgresql://h/db")).toBe("postgres");
    expect(sqlDialectOf("sqlserver://h:1433/db")).toBe("sqlserver");
    expect(sqlDialectOf("mssql://h/db")).toBe("sqlserver");
    expect(sqlDialectOf("oracle://h:2484/svc")).toBe("oracle");
    expect(sqlDialectOf("mysql://h/db")).toBe("mysql");
    expect(sqlDialectOf("mariadb://h/db")).toBe("mysql");
    expect(sqlDialectOf("sybase://h/db")).toBeNull();
    expect(sqlDialectOf("not a url")).toBeNull();
  });

  it("reads a query setting only when the query is exactly one setting", () => {
    expect(querySettingOf("{settings.accountQuery}")).toBe("accountQuery");
    expect(querySettingOf("SELECT {settings.accountQuery}")).toBeNull();
  });
});

describe("sqlQueryIssues", () => {
  const ok = (q: string) => expect(sqlQueryIssues(q), q).toEqual([]);
  const refused = (q: string) => expect(sqlQueryIssues(q).length, q).toBeGreaterThan(0);

  it("accepts every built-in definition's statements", () => {
    for (const def of BUILTIN_DEFINITIONS.filter((d) => d.driver === "sql")) {
      if (def.test?.query) ok(def.test.query);
      for (const kind of Object.keys(def.resources) as (keyof typeof def.resources)[]) {
        for (const spec of specsOf(def, kind)) if (!querySettingOf(spec.query)) ok(String(spec.query));
      }
    }
  });

  it("accepts ordinary reads", () => {
    ok("SELECT id, name FROM app_users WHERE note <> 'drop; it''s fine' ORDER BY id");
    ok("WITH u AS (SELECT * FROM users) SELECT * FROM u");
    ok("SELECT [User Name] FROM [dbo].[Users]");
    ok("SELECT REPLACE(name, 'a', 'b') AS name, updated_at FROM t");
  });

  it("refuses anything that writes, runs code or changes the session", () => {
    for (const q of [
      "DELETE FROM users",
      "select 1; drop table users",
      "SELECT 1 DROP TABLE users",
      "with x as (update t set a=1 returning *) select * from x",
      "EXEC sp_who",
      "SELECT * INTO backup FROM users",
      "SELECT * FROM users FOR UPDATE",
      "SELECT pg_sleep(10)",
      "SELECT dbms_pipe.receive_message('x', 10) FROM dual",
      "SELECT * FROM OPENROWSET('SQLNCLI', 'Server=x', 'SELECT 1')",
      "SELECT load_file('/etc/passwd')",
      "SELECT 1 WAITFOR DELAY '0:0:10'",
      "SELECT {settings.x}",
    ]) {
      refused(q);
    }
  });

  it("refuses quoting the check could read differently from the database", () => {
    // MySQL reads 'x\'' as one literal, which would hide what follows from a naive check.
    refused("SELECT 'x\\'', sleep(10) FROM t");
    refused("SELECT $$ ' $$, pg_sleep(1)");
    refused("SELECT q'[ ' ]', dbms_lock.sleep(1) FROM dual");
    refused("SELECT a[pg_sleep(1)] FROM t");
    refused("SELECT * FROM users -- comment");
    refused("SELECT * FROM users /* x */");
    refused("SELECT * FROM users # x");
  });
});

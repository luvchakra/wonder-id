import type { ConnectorDefinition } from "../types";

/**
 * Microsoft SQL Server (and Azure SQL Managed Instance): server logins,
 * server roles and the connected database's roles, and who holds which,
 * from the catalog views.
 */
export const sqlServer: ConnectorDefinition = {
  schemaVersion: 1,
  key: "sql-server",
  version: "1.0.0",
  name: "Microsoft SQL Server",
  vendor: "Microsoft",
  category: "database",
  description:
    "Server logins (sysadmin and CONTROL SERVER flagged, disabled logins), server roles and the connected database's roles, and which login holds which role. Reads only the catalog views, over encrypted TDS with the certificate verified.",
  documentationUrl: "https://learn.microsoft.com/sql/relational-databases/system-catalog-views/catalog-views-transact-sql",
  driver: "sql",
  sqlDialects: ["sqlserver"],
  settings: [
    { key: "url", label: "Database address", type: "url", required: true, help: "sqlserver://host:1433/database" },
    { key: "caCertificate", label: "CA certificate (PEM)", type: "string", help: "Only if the server's certificate is signed by a private CA" },
  ],
  auth: {
    type: "sql_password",
    username: "{secret.username}",
    password: "{secret.password}",
    fields: [
      { key: "username", label: "Login", help: "A SQL login with VIEW ANY DEFINITION, so it sees every login and role" },
      { key: "password", label: "Password" },
    ],
  },
  test: { query: "SELECT SUSER_SNAME() AS login_name" },
  application: "SQL Server",
  resources: {
    account: {
      query: `SELECT p.name, p.type_desc AS login_type, p.create_date, p.modify_date,
  CASE WHEN p.is_disabled = 1 THEN 'disabled' ELSE 'active' END AS status,
  CASE WHEN IS_SRVROLEMEMBER('sysadmin', p.name) = 1 OR EXISTS (
    SELECT 1 FROM sys.server_permissions sp
     WHERE sp.grantee_principal_id = p.principal_id AND sp.permission_name = 'CONTROL SERVER' AND sp.state IN ('G', 'W')) THEN 1 ELSE 0 END AS privileged
FROM sys.server_principals p
WHERE p.type IN ('S', 'U', 'G', 'E', 'X') AND p.name NOT LIKE '##%' AND LEFT(p.name, 11) <> 'NT SERVICE' + CHAR(92) AND LEFT(p.name, 13) <> 'NT AUTHORITY' + CHAR(92)
ORDER BY p.name`,
      fields: {
        externalId: "name",
        username: "name",
        status: "status",
        privileged: { path: "privileged", transform: ["boolean"] },
        createdAt: { path: "create_date", transform: ["date"] },
      },
    },
    entitlement: {
      query: `SELECT 'server:' + r.name AS id, r.name, 'server role' AS scope,
  CASE WHEN r.name IN ('sysadmin', 'securityadmin', 'serveradmin', 'setupadmin', 'processadmin', 'diskadmin', 'dbcreator', 'bulkadmin') THEN 'elevated' ELSE 'standard' END AS privilege_level
FROM sys.server_principals r
WHERE r.type = 'R' AND r.name <> 'public'
UNION ALL
SELECT 'database:' + DB_NAME() + ':' + r.name, r.name, 'role in database ' + DB_NAME(),
  CASE WHEN r.name IN ('db_owner', 'db_securityadmin', 'db_accessadmin', 'db_ddladmin', 'db_datawriter', 'db_backupoperator') THEN 'elevated' ELSE 'standard' END
FROM sys.database_principals r
WHERE r.type = 'R' AND r.name <> 'public'
ORDER BY 1`,
      fields: {
        externalId: "id",
        name: "name",
        type: { value: "role" },
        description: "scope",
        privilegeLevel: "privilege_level",
      },
    },
    access_grant: {
      query: `SELECT m.name AS member, 'server:' + r.name AS role
FROM sys.server_role_members rm
JOIN sys.server_principals r ON r.principal_id = rm.role_principal_id
JOIN sys.server_principals m ON m.principal_id = rm.member_principal_id
WHERE m.type IN ('S', 'U', 'G', 'E', 'X')
UNION ALL
SELECT l.name, 'database:' + DB_NAME() + ':' + r.name
FROM sys.database_role_members rm
JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
JOIN sys.database_principals u ON u.principal_id = rm.member_principal_id
JOIN sys.server_principals l ON l.sid = u.sid
ORDER BY 1, 2`,
      fields: {
        externalId: { template: "{record.member}>{record.role}" },
        accountExternalId: "member",
        entitlementExternalId: "role",
        grantType: { value: "direct" },
      },
    },
  },
};

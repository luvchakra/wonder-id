import type { ConnectorDefinition } from "../types";

/** MySQL 8: accounts (user@host), roles, and which account holds which role, from the grant tables. */
export const mysqlDatabase: ConnectorDefinition = {
  schemaVersion: 1,
  key: "mysql",
  version: "1.0.0",
  name: "MySQL",
  vendor: "Oracle",
  category: "database",
  description:
    "Accounts (user@host, locked and expired accounts, global SUPER, GRANT, FILE and user-administration privileges flagged), roles, and which account holds which role. Reads only the mysql grant tables, over TLS with the certificate verified.",
  documentationUrl: "https://dev.mysql.com/doc/refman/8.4/en/grant-tables.html",
  driver: "sql",
  sqlDialects: ["mysql"],
  settings: [
    { key: "url", label: "Database address", type: "url", required: true, help: "mysql://host:3306/database" },
    { key: "caCertificate", label: "CA certificate (PEM)", type: "string", help: "Only if the server's certificate is signed by a private CA" },
  ],
  auth: {
    type: "sql_password",
    username: "{secret.username}",
    password: "{secret.password}",
    fields: [
      { key: "username", label: "User", help: "An account with SELECT on mysql.user and mysql.role_edges only" },
      { key: "password", label: "Password" },
    ],
  },
  test: { query: "SELECT CURRENT_USER() AS login_name" },
  application: "MySQL",
  resources: {
    account: {
      query: `SELECT CONCAT(u.User, '@', u.Host) AS id, u.User AS username, u.Host AS host, u.password_last_changed,
  CASE WHEN u.account_locked = 'Y' THEN 'disabled' WHEN u.password_expired = 'Y' THEN 'expired' ELSE 'active' END AS status,
  (u.Super_priv = 'Y' OR u.Grant_priv = 'Y' OR u.Create_user_priv = 'Y' OR u.File_priv = 'Y' OR u.Shutdown_priv = 'Y' OR u.Process_priv = 'Y') AS privileged
FROM mysql.user u
WHERE u.User NOT IN ('', 'mysql.sys', 'mysql.session', 'mysql.infoschema')
  AND NOT EXISTS (SELECT 1 FROM mysql.role_edges e WHERE e.FROM_USER = u.User AND e.FROM_HOST = u.Host)
ORDER BY 1`,
      fields: {
        externalId: "id",
        username: "username",
        status: "status",
        privileged: { path: "privileged", transform: ["boolean"] },
      },
    },
    entitlement: {
      query: `SELECT DISTINCT CONCAT(e.FROM_USER, '@', e.FROM_HOST) AS id, e.FROM_USER AS name,
  CASE WHEN r.Super_priv = 'Y' OR r.Grant_priv = 'Y' OR r.Create_user_priv = 'Y' OR r.File_priv = 'Y' OR r.Insert_priv = 'Y' OR r.Update_priv = 'Y' OR r.Delete_priv = 'Y' OR r.Drop_priv = 'Y' THEN 'elevated' ELSE 'standard' END AS privilege_level
FROM mysql.role_edges e
LEFT JOIN mysql.user r ON r.User = e.FROM_USER AND r.Host = e.FROM_HOST
ORDER BY 1`,
      fields: {
        externalId: "id",
        name: "name",
        type: { value: "role" },
        privilegeLevel: "privilege_level",
      },
    },
    access_grant: {
      query: `SELECT CONCAT(e.TO_USER, '@', e.TO_HOST) AS member, CONCAT(e.FROM_USER, '@', e.FROM_HOST) AS role, e.WITH_ADMIN_OPTION AS admin_option
FROM mysql.role_edges e
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

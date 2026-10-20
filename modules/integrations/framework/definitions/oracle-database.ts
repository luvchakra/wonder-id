import type { ConnectorDefinition } from "../types";

/** Oracle Database: database users, roles with the privileges each carries, and role grants, from the data dictionary. */
export const oracleDatabase: ConnectorDefinition = {
  schemaVersion: 1,
  key: "oracle-database",
  version: "1.0.0",
  name: "Oracle Database",
  vendor: "Oracle",
  category: "database",
  description:
    "Database users (locked and expired accounts, last login, DBA and ANY privileges flagged), roles with how many system and object privileges each carries, and which user holds which role. Reads only the data dictionary, over TCPS with the certificate verified. Oracle-maintained users are left out.",
  documentationUrl: "https://docs.oracle.com/en/database/oracle/oracle-database/23/refrn/DBA_USERS.html",
  driver: "sql",
  sqlDialects: ["oracle"],
  settings: [
    { key: "url", label: "Database address", type: "url", required: true, help: "oracle://host:2484/service_name (the TCPS listener)" },
  ],
  auth: {
    type: "sql_password",
    username: "{secret.username}",
    password: "{secret.password}",
    wallet: "{secret.wallet}",
    walletPassword: "{secret.walletPassword}",
    fields: [
      { key: "username", label: "User", help: "A user with CREATE SESSION and SELECT_CATALOG_ROLE, so it can read the DBA_ views" },
      { key: "password", label: "Password" },
      { key: "wallet", label: "Wallet (ewallet.pem)", help: "Only if the listener's certificate is signed by a private CA", optional: true },
      { key: "walletPassword", label: "Wallet password", help: "Only if the wallet's key is encrypted", optional: true },
    ],
  },
  test: { query: "SELECT USER AS login_name FROM DUAL" },
  application: "Oracle Database",
  resources: {
    account: {
      query: `SELECT u.username, u.account_status, u.created, u.expiry_date, u.last_login, u.authentication_type, u.profile,
  CASE WHEN u.account_status = 'OPEN' THEN 'active' WHEN u.account_status LIKE '%EXPIRED%' AND u.account_status NOT LIKE '%LOCKED%' THEN 'expired' ELSE 'disabled' END AS status,
  CASE WHEN EXISTS (SELECT 1 FROM dba_role_privs rp WHERE rp.grantee = u.username AND rp.granted_role IN ('DBA', 'IMP_FULL_DATABASE', 'DATAPUMP_IMP_FULL_DATABASE'))
         OR EXISTS (SELECT 1 FROM dba_sys_privs sp WHERE sp.grantee = u.username AND (sp.privilege LIKE '% ANY %' OR sp.privilege IN ('ALTER SYSTEM', 'ALTER USER', 'BECOME USER', 'SYSDBA', 'SYSOPER')))
       THEN 1 ELSE 0 END AS privileged
FROM dba_users u
WHERE u.oracle_maintained = 'N'
ORDER BY u.username`,
      fields: {
        externalId: "username",
        username: "username",
        status: "status",
        privileged: { path: "privileged", transform: ["boolean"] },
        createdAt: { path: "created", transform: ["date"] },
        lastLoginAt: { path: "last_login", transform: ["date"] },
        expiresAt: { path: "expiry_date", transform: ["date"] },
      },
    },
    entitlement: {
      query: `SELECT r.role,
  (SELECT COUNT(*) FROM dba_sys_privs sp WHERE sp.grantee = r.role) AS system_privileges,
  (SELECT COUNT(*) FROM dba_tab_privs tp WHERE tp.grantee = r.role) AS object_privileges,
  CASE WHEN r.role IN ('DBA', 'IMP_FULL_DATABASE', 'EXP_FULL_DATABASE', 'DATAPUMP_IMP_FULL_DATABASE', 'DATAPUMP_EXP_FULL_DATABASE')
         OR EXISTS (SELECT 1 FROM dba_sys_privs sp WHERE sp.grantee = r.role AND (sp.privilege LIKE '% ANY %' OR sp.privilege IN ('ALTER SYSTEM', 'ALTER USER', 'BECOME USER')))
       THEN 'elevated' ELSE 'standard' END AS privilege_level
FROM dba_roles r
WHERE r.oracle_maintained = 'N' OR r.role IN (SELECT rp.granted_role FROM dba_role_privs rp JOIN dba_users u ON u.username = rp.grantee WHERE u.oracle_maintained = 'N')
ORDER BY r.role`,
      fields: {
        externalId: "role",
        name: "role",
        type: { value: "role" },
        description: { template: "{record.system_privileges} system and {record.object_privileges} object privileges" },
        privilegeLevel: "privilege_level",
      },
    },
    access_grant: {
      query: `SELECT rp.grantee AS member, rp.granted_role AS role, rp.admin_option
FROM dba_role_privs rp
JOIN dba_users u ON u.username = rp.grantee
WHERE u.oracle_maintained = 'N'
ORDER BY 1, 2`,
      fields: {
        externalId: { template: "{record.member}:{record.role}" },
        accountExternalId: "member",
        entitlementExternalId: "role",
        grantType: { value: "direct" },
      },
    },
  },
};

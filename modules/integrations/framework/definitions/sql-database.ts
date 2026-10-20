import type { ConnectorDefinition, SettingField } from "../types";

const query = (key: string, label: string, columns: string): SettingField => ({
  key,
  label,
  type: "string",
  help: `One SELECT returning the columns ${columns}; leave empty to skip`,
});

/**
 * Any database the sql driver speaks, read with the organization's own
 * SELECT statements: an application's users and roles kept in its own
 * tables. Each statement returns fixed column names, so one mapping fits
 * every schema; each is checked as strictly as a definition's query.
 */
export const sqlDatabase: ConnectorDefinition = {
  schemaVersion: 1,
  key: "sql-database",
  version: "1.0.0",
  name: "Database (your own queries)",
  category: "database",
  description:
    "People, accounts, entitlements and who holds what, read from any PostgreSQL, SQL Server, Oracle, MySQL or MariaDB database with SELECT statements you write. Each statement runs read-only, under a timeout and a row limit, over verified TLS.",
  driver: "sql",
  settings: [
    { key: "url", label: "Database address", type: "url", required: true, help: "postgres://, sqlserver://, oracle://, mysql:// or mariadb://host:port/database" },
    { key: "caCertificate", label: "CA certificate (PEM)", type: "string", help: "Only if the server's certificate is signed by a private CA" },
    { key: "application", label: "Application name", type: "string", required: true, help: "The application these accounts belong to" },
    { key: "timeoutSeconds", label: "Query timeout (seconds)", type: "number", default: 30, help: "From 5 to 120" },
    query("identityQuery", "People query", "id, display_name, first_name, last_name, email, username, title, department, manager_id, start_date, end_date, status"),
    query("accountQuery", "Accounts query", "id, username, email, display_name, status, privileged, last_login_at, created_at, expires_at"),
    query("entitlementQuery", "Entitlements query", "id, name, type, description, privilege_level"),
    query("grantQuery", "Access query", "account_id, entitlement_id"),
  ],
  auth: {
    type: "sql_password",
    username: "{secret.username}",
    password: "{secret.password}",
    wallet: "{secret.wallet}",
    walletPassword: "{secret.walletPassword}",
    fields: [
      { key: "username", label: "Login", help: "A login that can only read the tables your queries name" },
      { key: "password", label: "Password" },
      { key: "wallet", label: "Oracle wallet (ewallet.pem)", help: "Oracle only, when its certificate is signed by a private CA", optional: true },
      { key: "walletPassword", label: "Oracle wallet password", help: "Only if the wallet's key is encrypted", optional: true },
    ],
  },
  test: { query: "SELECT 1 AS ok" },
  application: "{settings.application}",
  resources: {
    identity: {
      query: "{settings.identityQuery}",
      fields: {
        externalId: { path: "id", transform: ["string"] },
        displayName: { path: ["display_name", "username"], default: null },
        firstName: { path: "first_name", default: null },
        lastName: { path: "last_name", default: null },
        email: { path: "email", transform: ["lower"], default: null },
        username: { path: "username", default: null },
        title: { path: "title", default: null },
        department: { path: "department", default: null },
        managerExternalId: { path: "manager_id", transform: ["string"], default: null },
        startDate: { path: "start_date", transform: ["date"] },
        endDate: { path: "end_date", transform: ["date"] },
        status: { path: "status", transform: ["lower"], default: "active" },
      },
    },
    account: {
      query: "{settings.accountQuery}",
      fields: {
        externalId: { path: "id", transform: ["string"] },
        username: { path: "username", default: null },
        email: { path: "email", transform: ["lower"], default: null },
        displayName: { path: "display_name", default: null },
        status: { path: "status", transform: ["lower"], default: "active" },
        privileged: { path: "privileged", transform: ["boolean"] },
        lastLoginAt: { path: "last_login_at", transform: ["date"] },
        createdAt: { path: "created_at", transform: ["date"] },
        expiresAt: { path: "expires_at", transform: ["date"] },
      },
    },
    entitlement: {
      query: "{settings.entitlementQuery}",
      fields: {
        externalId: { path: "id", transform: ["string"] },
        name: { path: ["name", "id"], transform: ["string"] },
        type: { path: "type", default: "role" },
        description: { path: "description", default: null },
        privilegeLevel: { path: "privilege_level", transform: ["lower"], default: null },
      },
    },
    access_grant: {
      query: "{settings.grantQuery}",
      fields: {
        externalId: { template: "{record.account_id}>{record.entitlement_id}" },
        accountExternalId: { path: "account_id", transform: ["string"] },
        entitlementExternalId: { path: "entitlement_id", transform: ["string"] },
        grantType: { value: "direct" },
      },
    },
  },
};

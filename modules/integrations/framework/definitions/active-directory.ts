import type { ConnectorDefinition, FieldMapping, ResourceSpec } from "../types";

/**
 * Microsoft Active Directory (Windows Server AD DS) over LDAPS: people as
 * identities and accounts, managed service accounts, security and
 * distribution groups, and group memberships.
 *
 * Whether an account is disabled is bit 2 of userAccountControl. Mappings
 * have no bitwise transform, so each kind is read twice, with AD's bitwise
 * matching rule (LDAP_MATCHING_RULE_BIT_AND) choosing enabled or disabled
 * entries, and each search sets the status. Memberships are read from each
 * account's memberOf, so a group past AD's 1,500-value range limit on
 * `member` is still read whole. memberOf leaves out the primary group
 * (Domain Users) and nested memberships.
 *
 * Records are keyed by DN, as group changes name DNs. Disabling an account
 * is not offered: it means rewriting userAccountControl, which would drop
 * the account's other flags.
 */

const DISABLED = "(userAccountControl:1.2.840.113556.1.4.803:=2)";

const ACCOUNT_ATTRIBUTES = ["sAMAccountName", "userPrincipalName", "mail", "displayName", "cn", "adminCount", "lastLogonTimestamp", "whenCreated", "accountExpires", "memberOf"];

const IDENTITY_ATTRIBUTES = [
  "sAMAccountName",
  "mail",
  "displayName",
  "cn",
  "givenName",
  "sn",
  "title",
  "department",
  "division",
  "company",
  "physicalDeliveryOfficeName",
  "l",
  "employeeType",
  "manager",
  "accountExpires",
];

/** The same search twice: enabled entries, then disabled ones, each with its status. */
function enabledAndDisabled(filter: string, attributes: string[], fields: Record<string, FieldMapping>, statuses: [string, string]): ResourceSpec[] {
  return [
    { search: { base: "{settings.baseDn}", filter: `(&${filter}(!${DISABLED}))`, attributes }, fields: { ...fields, status: { value: statuses[0] } } },
    { search: { base: "{settings.baseDn}", filter: `(&${filter}${DISABLED})`, attributes }, fields: { ...fields, status: { value: statuses[1] } } },
  ];
}

const accountFields = (accountType: "human" | "service"): Record<string, FieldMapping> => ({
  externalId: "dn",
  username: { path: ["sAMAccountName", "userPrincipalName"], transform: ["first"] },
  email: { path: ["mail", "userPrincipalName"], transform: ["first", "lower"] },
  ...(accountType === "human" ? { owner: { path: "mail", transform: ["first", "lower"] } } : {}),
  displayName: { path: ["displayName", "cn"], transform: ["first"] },
  accountType: { value: accountType },
  // adminCount=1: AD's protected accounts (members of Domain Admins and the other protected groups, now or before).
  privileged: { path: "adminCount", transform: ["first", "boolean"] },
  lastLoginAt: { path: "lastLogonTimestamp", transform: ["first", "filetime"] },
  createdAt: { path: "whenCreated", transform: ["date"] },
  expiresAt: { path: "accountExpires", transform: ["first", "filetime"] },
  entitlements: "memberOf",
});

// groupType: the security bit (0x80000000) makes the value negative.
const GROUP_TYPES = {
  "-2147483646": "security_group",
  "-2147483644": "security_group",
  "-2147483643": "security_group",
  "-2147483640": "security_group",
  "2": "distribution_group",
  "4": "distribution_group",
  "8": "distribution_group",
};

export const activeDirectory: ConnectorDefinition = {
  schemaVersion: 1,
  key: "active-directory",
  version: "1.0.0",
  name: "Active Directory",
  vendor: "Microsoft",
  category: "directory",
  description:
    "People, accounts, managed service accounts, groups and group memberships from Microsoft Active Directory over LDAPS, with disabled, privileged (adminCount) and expiring accounts and last sign-in. Can add and remove group members once an administrator turns changes on, if the bind account may change those groups.",
  driver: "ldap",
  settings: [
    { key: "url", label: "Domain controller address", type: "url", required: true, help: "ldaps://dc01.corp.example.com:636, or port 3269 for the global catalog" },
    { key: "baseDn", label: "Base DN", type: "string", required: true, help: "The domain or OU to read, for example DC=corp,DC=example,DC=com" },
    { key: "userFilter", label: "People filter", type: "string", default: "(&(objectCategory=person)(objectClass=user))" },
    { key: "serviceAccountFilter", label: "Service account filter", type: "string", default: "(|(objectClass=msDS-ManagedServiceAccount)(objectClass=msDS-GroupManagedServiceAccount))" },
    { key: "groupFilter", label: "Group filter", type: "string", default: "(objectClass=group)" },
    { key: "caCertificate", label: "CA certificate (PEM)", type: "string", help: "Only if the domain controller's certificate comes from an internal certificate authority (AD CS)" },
  ],
  auth: {
    type: "ldap_simple",
    bindDn: "{secret.bindDn}",
    password: "{secret.password}",
    fields: [
      {
        key: "bindDn",
        label: "Bind account",
        help: "A service account's DN (CN=svc-wonderid,OU=Service Accounts,DC=corp,DC=example,DC=com) or user principal name (svc-wonderid@corp.example.com). Read access is enough unless changes are turned on; then it must be able to change group membership.",
      },
      { key: "password", label: "Password" },
    ],
  },
  test: { search: { base: "{settings.baseDn}", filter: "(objectClass=*)", scope: "base" } },
  application: "Active Directory ({settings.baseDn})",
  resources: {
    identity: enabledAndDisabled(
      "{settings.userFilter}",
      IDENTITY_ATTRIBUTES,
      {
        externalId: "dn",
        displayName: { path: ["displayName", "cn"], transform: ["first"] },
        firstName: { path: "givenName", transform: ["first"] },
        lastName: { path: "sn", transform: ["first"] },
        email: { path: "mail", transform: ["first", "lower"] },
        username: { path: "sAMAccountName", transform: ["first"] },
        title: { path: "title", transform: ["first"] },
        department: { path: "department", transform: ["first"] },
        businessUnit: { path: "division", transform: ["first"] },
        organization: { path: "company", transform: ["first"] },
        location: { path: ["physicalDeliveryOfficeName", "l"], transform: ["first"] },
        employmentType: { path: "employeeType", transform: ["first"] },
        managerExternalId: { path: "manager", transform: ["first"] },
        endDate: { path: "accountExpires", transform: ["first", "filetime"] },
        identityType: { value: "HUMAN" },
      },
      ["active", "inactive"],
    ),
    account: [
      ...enabledAndDisabled("{settings.userFilter}", ACCOUNT_ATTRIBUTES, accountFields("human"), ["active", "disabled"]),
      ...enabledAndDisabled("{settings.serviceAccountFilter}", ACCOUNT_ATTRIBUTES, accountFields("service"), ["active", "disabled"]),
    ],
    entitlement: {
      search: { base: "{settings.baseDn}", filter: "{settings.groupFilter}", attributes: ["cn", "sAMAccountName", "description", "groupType", "adminCount"] },
      fields: {
        externalId: "dn",
        name: { path: ["cn", "sAMAccountName"], transform: ["first"] },
        description: { path: "description", transform: ["first"] },
        type: { path: "groupType", transform: ["first", { map: GROUP_TYPES, default: "group" }] },
        privilegeLevel: { path: "adminCount", transform: ["first", { map: { "1": "admin" }, default: "standard" }] },
      },
    },
    access_grant: {
      search: { base: "{settings.baseDn}", filter: "(|{settings.userFilter}{settings.serviceAccountFilter})", attributes: ["memberOf"] },
      unwind: "memberOf",
      fields: {
        externalId: { template: "{record.value}|{parent.dn}" },
        accountExternalId: "parent.dn",
        entitlementExternalId: "value",
        grantType: { value: "group" },
      },
    },
  },
  write: {
    grant_access: { ldap: { dn: "{target.entitlement}", modify: [{ operation: "add", attribute: "member", values: ["{target.account}"] }] } },
    revoke_access: { ldap: { dn: "{target.entitlement}", modify: [{ operation: "delete", attribute: "member", values: ["{target.account}"] }] } },
  },
  documentationUrl: "https://learn.microsoft.com/en-us/windows/win32/adschema/active-directory-schema",
};

import type { ConnectorDefinition } from "../types";

/** A Windows server's local accounts and groups, read and changed with PowerShell over WinRM (HTTPS). */
export const windowsPowerShell: ConnectorDefinition = {
  schemaVersion: 1,
  key: "windows-powershell",
  version: "1.0.0",
  name: "Windows server (PowerShell)",
  vendor: "Microsoft",
  category: "infrastructure",
  description:
    "Local accounts (enabled, last sign-in, password age), local groups and their members on a Windows server or workstation, read with PowerShell over WinRM on HTTPS. Can disable an account and add or remove group members once an administrator turns changes on. Not for domain controllers, which have no local accounts.",
  documentationUrl: "https://learn.microsoft.com/powershell/module/microsoft.powershell.localaccounts/",
  driver: "powershell",
  settings: [
    { key: "url", label: "WinRM address", type: "url", required: true, help: "https://server.example.com:5986/wsman (an HTTPS listener with Basic authentication enabled)" },
    { key: "edition", label: "PowerShell", type: "select", options: ["Windows PowerShell 5.1", "PowerShell 7"], default: "Windows PowerShell 5.1" },
    { key: "excludeAccounts", label: "Accounts to leave out", type: "string", default: "DefaultAccount,WDAGUtilityAccount", help: "Names, separated by commas" },
  ],
  auth: {
    type: "basic",
    username: "{secret.username}",
    password: "{secret.password}",
    fields: [
      { key: "username", label: "User name", help: "A local account of the server. Reading needs no administrator rights unless changes are turned on." },
      { key: "password", label: "Password" },
    ],
  },
  test: { powershell: { script: "Get-LocalGroup -SID 'S-1-5-32-544' | Select-Object -ExpandProperty Name" } },
  application: "Windows ({settings.url})",
  resources: {
    account: {
      powershell: {
        script: `param([string]$Exclude)
$skip = @($Exclude -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
Get-LocalUser | Where-Object { $skip -notcontains $_.Name } | ForEach-Object {
  [pscustomobject]@{
    sid = $_.SID.Value
    name = $_.Name
    fullName = $_.FullName
    description = $_.Description
    enabled = [bool]$_.Enabled
    lastLogon = if ($_.LastLogon) { $_.LastLogon.ToUniversalTime().ToString('o') } else { $null }
    passwordLastSet = if ($_.PasswordLastSet) { $_.PasswordLastSet.ToUniversalTime().ToString('o') } else { $null }
    expires = if ($_.AccountExpires) { $_.AccountExpires.ToUniversalTime().ToString('o') } else { $null }
  }
}`,
        parameters: { Exclude: "{settings.excludeAccounts}" },
      },
      fields: {
        externalId: "sid",
        username: "name",
        displayName: { path: ["fullName", "name"] },
        status: { path: "enabled", transform: [{ map: { true: "active", false: "disabled" } }] },
        accountType: { value: "human" },
        lastLoginAt: { path: "lastLogon", default: null },
        expiresAt: { path: "expires", transform: ["date"] },
      },
    },
    entitlement: {
      powershell: {
        script: `Get-LocalGroup | ForEach-Object { [pscustomobject]@{ sid = $_.SID.Value; name = $_.Name; description = $_.Description } }`,
      },
      fields: {
        externalId: "sid",
        name: "name",
        description: { path: "description", default: null },
        type: { value: "group" },
        // Administrators, Remote Management Users, Backup Operators and the like.
        privilegeLevel: { path: "sid", transform: [{ map: { "S-1-5-32-544": "admin", "S-1-5-32-551": "elevated", "S-1-5-32-549": "elevated", "S-1-5-32-548": "elevated", "S-1-5-32-580": "elevated" }, default: "standard" }] },
      },
    },
    access_grant: {
      powershell: {
        script: `Get-LocalGroup | ForEach-Object {
  $group = $_
  Get-LocalGroupMember -SID $group.SID | ForEach-Object {
    [pscustomobject]@{ group = $group.SID.Value; member = $_.SID.Value; memberName = $_.Name; objectClass = [string]$_.ObjectClass; source = [string]$_.PrincipalSource }
  }
}`,
      },
      fields: {
        externalId: { template: "{record.group}|{record.member}" },
        accountExternalId: "member",
        entitlementExternalId: "group",
        grantType: { path: "objectClass", transform: [{ map: { Group: "group" }, default: "direct" }] },
      },
    },
  },
  write: {
    disable_account: {
      powershell: { script: "param([string]$Account) Disable-LocalUser -SID $Account", parameters: { Account: "{target.account}" } },
      repeatable: true,
    },
    revoke_access: {
      powershell: {
        script: `param([string]$Group, [string]$Account)
try { Remove-LocalGroupMember -SID $Group -Member $Account } catch [Microsoft.PowerShell.Commands.MemberNotFoundException] { }`,
        parameters: { Group: "{target.entitlement}", Account: "{target.account}" },
      },
      repeatable: true,
    },
    grant_access: {
      powershell: {
        script: `param([string]$Group, [string]$Account)
try { Add-LocalGroupMember -SID $Group -Member $Account } catch [Microsoft.PowerShell.Commands.MemberExistsException] { }`,
        parameters: { Group: "{target.entitlement}", Account: "{target.account}" },
      },
      repeatable: true,
    },
  },
};

import type { ConnectorDefinition } from "../types";
import { frappeHr } from "./frappe-hr";
import { erpnext } from "./erpnext";
import { ldapDirectory } from "./ldap-directory";
import { activeDirectory } from "./active-directory";
import { keycloak } from "./keycloak";
import { gitea } from "./gitea";
import { mattermost } from "./mattermost";
import { nextcloud } from "./nextcloud";
import { postgresql } from "./postgresql";
import { windowsPowerShell } from "./windows-powershell";
import { sqlServer } from "./sql-server";
import { oracleDatabase } from "./oracle-database";
import { mysqlDatabase } from "./mysql";
import { sqlDatabase } from "./sql-database";
import { openbao } from "./openbao";
import { kubernetes } from "./kubernetes";
import { saviynt } from "./saviynt";
import { zendesk } from "./zendesk";
import { mcpServer } from "./mcp-server";
import { runtimeGateway } from "./runtime-gateway";
import { webhook } from "./webhook";
import { csvFile } from "./csv-file";
import { scim } from "./scim";
import { scimInbound } from "./scim-inbound";
import { restApi } from "./rest-api";

/**
 * WonderID's built-in connector definitions, one per product. Each is
 * generic: any organization running that product can use it by entering
 * its own address and credentials. definitions.test.ts validates every one.
 */
export const BUILTIN_DEFINITIONS: ConnectorDefinition[] = [frappeHr, erpnext, ldapDirectory, activeDirectory, keycloak, gitea, mattermost, nextcloud, postgresql, sqlServer, oracleDatabase, mysqlDatabase, sqlDatabase, windowsPowerShell, openbao, kubernetes, saviynt, zendesk, scim, scimInbound, restApi, mcpServer, runtimeGateway, webhook, csvFile];

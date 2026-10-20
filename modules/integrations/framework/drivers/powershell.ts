import { randomUUID } from "node:crypto";
import type { ConnectorDriverSession, DriverFactory } from "../engine";
import { ConnectorRequestError, type FetchLike } from "../http";
import { fillTemplate, readPath, type TemplateScope } from "../mapping";
import type { PowerShellParameter, PowerShellSpec } from "../types";
import { addressKey } from "../address";

/**
 * The powershell driver: runs a definition's PowerShell script on the
 * organization's Windows server over WinRM (WS-Management, HTTPS, port
 * 5986 by default) and reads what it outputs as JSON.
 *
 * - Transport: the connection's own address only, through the metered
 *   fetch the Connector Gateway hands it (policies, SSRF guard, timeout,
 *   size cap). HTTP Basic over HTTPS: the server needs Basic enabled for
 *   WinRM and an HTTPS listener with a certificate it can verify.
 * - Parameters: filled from the definition's templates and sent as base64
 *   JSON inside the command, so a value from a record or a target can never
 *   become code. The script gets them as named parameters and `$Params`.
 * - Answers: the script's output is converted to JSON on the server and
 *   framed between markers, so anything else it prints is ignored. An error
 *   the script throws comes back as a failed run with its message; an
 *   object-not-found error is a 404, so an `optional` resource reads none.
 * - Reads run with `$WhatIfPreference` on, so a cmdlet that supports
 *   -WhatIf only reports what it would do (the validator also refuses
 *   changing commands in read scripts). Writes run without it.
 */

const SHELL_URI = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell";
const ACTION = {
  create: "http://schemas.xmlsoap.org/ws/2004/09/transfer/Create",
  delete: "http://schemas.xmlsoap.org/ws/2004/09/transfer/Delete",
  command: `${SHELL_URI}/Command`,
  receive: `${SHELL_URI}/Receive`,
  signal: `${SHELL_URI}/Signal`,
};
const DONE_STATE = `${SHELL_URI}/CommandState/Done`;
/** WinRM's "the operation timed out" fault: a Receive with nothing new yet. */
const TIMED_OUT_CODE = "2150858793";
const RESULT_START = "<<WONDERID-RESULT>>";
const RESULT_END = "<<WONDERID-END>>";
/** Windows' command-line limit is 32 767 characters; leave room for the executable and flags. */
export const MAX_ENCODED_COMMAND = 32_000;
/** One run's output, at most (20 MB). */
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
/** Receives per run: each waits up to 15 s on the server, so about ten minutes in all. */
const MAX_RECEIVES = 40;
export const DEFAULT_DEPTH = 4;

export type PowerShellResult = { ok: true; output: unknown[] } | { ok: false; error: string; category: string; errorId: string };

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One WS-Management request envelope. */
export function envelope(input: { to: string; action: string; shellId?: string; options?: Record<string, string>; timeoutSeconds?: number; body: string }): string {
  const selector = input.shellId ? `<w:SelectorSet><w:Selector Name="ShellId">${xml(input.shellId)}</w:Selector></w:SelectorSet>` : "";
  const options = input.options
    ? `<w:OptionSet>${Object.entries(input.options)
        .map(([k, v]) => `<w:Option Name="${xml(k)}">${xml(v)}</w:Option>`)
        .join("")}</w:OptionSet>`
    : "";
  return (
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" ` +
    `xmlns:w="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns:rsp="${SHELL_URI}">` +
    `<s:Header><a:To>${xml(input.to)}</a:To>` +
    `<a:ReplyTo><a:Address s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>` +
    `<w:ResourceURI s:mustUnderstand="true">${SHELL_URI}/cmd</w:ResourceURI>` +
    `<a:Action s:mustUnderstand="true">${input.action}</a:Action>` +
    `<w:MaxEnvelopeSize s:mustUnderstand="true">512000</w:MaxEnvelopeSize>` +
    `<a:MessageID>uuid:${randomUUID()}</a:MessageID>` +
    `<w:Locale xml:lang="en-US" s:mustUnderstand="false"/>` +
    `<w:OperationTimeout>PT${input.timeoutSeconds ?? 15}S</w:OperationTimeout>` +
    selector +
    options +
    `</s:Header><s:Body>${input.body}</s:Body></s:Envelope>`
  );
}

const tagText = (text: string, tag: string): string | null => new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([^<]*)</(?:[\\w-]+:)?${tag}>`).exec(text)?.[1]?.trim() ?? null;

const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** A SOAP fault's message and WS-Management code, or null when the reply is not a fault. */
export function parseFault(text: string): { message: string; code: string | null } | null {
  if (!/<(?:[\w-]+:)?Fault\b/.test(text)) return null;
  const code = /<(?:[\w-]+:)?WSManFault\b[^>]*\bCode="(\d+)"/.exec(text)?.[1] ?? null;
  const message = tagText(text, "Message") ?? tagText(text, "Text") ?? "The server returned a fault";
  return { message: unescapeXml(message).replace(/\s+/g, " ").slice(0, 300), code };
}

/** What one Receive returned: the stdout and stderr chunks, and whether the command finished. */
export function parseReceive(text: string): { stdout: Buffer[]; stderr: Buffer[]; done: boolean; exitCode: number | null } {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  for (const m of text.matchAll(/<(?:[\w-]+:)?Stream\b([^>]*?)(?:\/>|>([^<]*)<\/(?:[\w-]+:)?Stream>)/g)) {
    const name = /\bName="([^"]+)"/.exec(m[1])?.[1];
    const data = (m[2] ?? "").trim();
    if (!data) continue;
    (name === "stderr" ? stderr : stdout).push(Buffer.from(data, "base64"));
  }
  const done = new RegExp(`State="${DONE_STATE.replace(/[/.]/g, "\\$&")}"`).test(text);
  const exit = tagText(text, "ExitCode");
  return { stdout, stderr, done, exitCode: exit === null ? null : Number(exit) };
}

/** PowerShell's -EncodedCommand: base64 of the script's UTF-16LE text. */
export const encodeCommand = (script: string) => Buffer.from(script, "utf16le").toString("base64");

/**
 * The script WonderID runs: the definition's script inside a script block,
 * called with the parameters, its output framed as base64 JSON between
 * markers. `readOnly` turns -WhatIf on for every cmdlet that supports it.
 */
export function wrapScript(spec: PowerShellSpec, parameters: Record<string, unknown>, readOnly: boolean): string {
  const params = Buffer.from(JSON.stringify(parameters), "utf8").toString("base64");
  const depth = Math.min(10, Math.max(1, Math.floor(spec.depth ?? DEFAULT_DEPTH)));
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$wonderidResult = $null",
    "try {",
    "  $Params = @{}",
    `  $wonderidIn = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${params}'))`,
    "  (ConvertFrom-Json $wonderidIn).PSObject.Properties | ForEach-Object { $Params[$_.Name] = $_.Value }",
    readOnly ? "  $WhatIfPreference = $true; $PSDefaultParameterValues['*:WhatIf'] = $true" : "",
    "  $wonderidOut = @(& {",
    spec.script,
    "  } @Params)",
    "  $wonderidResult = @{ ok = $true; output = $wonderidOut }",
    "} catch {",
    "  $wonderidResult = @{ ok = $false; error = [string]$_.Exception.Message; category = [string]$_.CategoryInfo.Category; errorId = [string]$_.FullyQualifiedErrorId }",
    "}",
    "$WhatIfPreference = $false",
    `$wonderidJson = ConvertTo-Json -InputObject $wonderidResult -Depth ${depth + 1} -Compress`,
    `[Console]::Out.Write("\`n${RESULT_START}" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($wonderidJson)) + "${RESULT_END}\`n")`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Windows PowerShell 5.1 writes dates as "/Date(ms)/"; every such text becomes ISO 8601. */
export function normalizeDates(value: unknown): unknown {
  if (typeof value === "string") {
    const m = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
    return m ? new Date(Number(m[1])).toISOString() : value;
  }
  if (Array.isArray(value)) return value.map(normalizeDates);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeDates(v)]));
  return value;
}

/** The framed result in what the command printed, or null when there is none. */
export function parseResult(stdout: string): PowerShellResult | null {
  const start = stdout.lastIndexOf(RESULT_START);
  const end = start < 0 ? -1 : stdout.indexOf(RESULT_END, start);
  if (start < 0 || end < 0) return null;
  try {
    const json = Buffer.from(stdout.slice(start + RESULT_START.length, end).trim(), "base64").toString("utf8");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (parsed.ok === true) {
      const output = parsed.output === null || parsed.output === undefined ? [] : Array.isArray(parsed.output) ? parsed.output : [parsed.output];
      return { ok: true, output: normalizeDates(output) as unknown[] };
    }
    return { ok: false, error: String(parsed.error ?? "The script failed"), category: String(parsed.category ?? ""), errorId: String(parsed.errorId ?? "") };
  } catch {
    return null;
  }
}

/** stderr as readable text: PowerShell's CLIXML error records reduced to their messages. */
export function readableStderr(raw: string): string {
  const text = raw.includes("#< CLIXML")
    ? [...raw.matchAll(/<S S="Error">([^<]*)<\/S>/g)].map((m) => unescapeXml(m[1]).replace(/_x000D__x000A_/g, " ")).join("")
    : raw;
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Each parameter filled from the scope: templates in texts and lists; numbers and true/false as they are. */
export function fillParameters(parameters: Record<string, PowerShellParameter> | undefined, scope: TemplateScope): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(parameters ?? {})) {
    if (typeof value === "string") out[name] = fillTemplate(value, scope);
    else if (Array.isArray(value)) out[name] = value.map((v) => fillTemplate(v, scope));
    else out[name] = value;
  }
  return out;
}

export function powershellDriver(fetchImpl: FetchLike): DriverFactory {
  return async (def, settings, secrets): Promise<ConnectorDriverSession> => {
    if (def.auth.type !== "basic") throw new Error("The powershell driver signs in with a user name and password (auth type basic)");
    const endpoint = new URL(String(settings[addressKey(def)!]));
    if (!endpoint.pathname || endpoint.pathname === "/") endpoint.pathname = "/wsman";
    const to = endpoint.toString();
    const auth = { settings, secret: secrets };
    const basic = Buffer.from(`${fillTemplate(def.auth.username, auth)}:${fillTemplate(def.auth.password, auth)}`, "utf8").toString("base64");
    const executable = settings.edition === "PowerShell 7" ? "pwsh.exe" : "powershell.exe";

    async function post(body: string): Promise<string> {
      const res = await fetchImpl(to, {
        method: "POST",
        headers: { "Content-Type": "application/soap+xml;charset=UTF-8", Authorization: `Basic ${basic}` },
        body,
      });
      const text = await res.text();
      if (res.status === 401) throw new ConnectorRequestError("The server refused the user name or password (WinRM needs Basic authentication enabled on its HTTPS listener)", 401);
      const fault = parseFault(text);
      if (fault) throw Object.assign(new ConnectorRequestError(`WinRM: ${fault.message}`, res.status), { wsmanCode: fault.code });
      if (!res.ok) throw new ConnectorRequestError(`WinRM answered HTTP ${res.status}`, res.status);
      return text;
    }

    /** Runs one script and returns what it reported. The shell is always closed again. */
    async function run(spec: PowerShellSpec, scope: TemplateScope, readOnly: boolean): Promise<PowerShellResult> {
      const encoded = encodeCommand(wrapScript(spec, fillParameters(spec.parameters, scope), readOnly));
      if (encoded.length > MAX_ENCODED_COMMAND) {
        throw new ConnectorRequestError(`The script and its parameters are too long to send (${encoded.length} characters encoded, at most ${MAX_ENCODED_COMMAND})`);
      }
      const created = await post(
        envelope({
          to,
          action: ACTION.create,
          options: { WINRS_NOPROFILE: "TRUE", WINRS_CODEPAGE: "65001" },
          body: `<rsp:Shell><rsp:InputStreams>stdin</rsp:InputStreams><rsp:OutputStreams>stdout stderr</rsp:OutputStreams></rsp:Shell>`,
        }),
      );
      const shellId = /<(?:[\w-]+:)?Selector Name="ShellId">([^<]+)</.exec(created)?.[1] ?? tagText(created, "ShellId");
      if (!shellId) throw new ConnectorRequestError("WinRM did not open a shell");
      let commandId: string | null = null;
      try {
        const started = await post(
          envelope({
            to,
            action: ACTION.command,
            shellId,
            options: { WINRS_CONSOLEMODE_STDIN: "TRUE", WINRS_SKIP_CMD_SHELL: "TRUE" },
            body: `<rsp:CommandLine><rsp:Command>${executable}</rsp:Command><rsp:Arguments>-NoLogo -NoProfile -NonInteractive -EncodedCommand ${encoded}</rsp:Arguments></rsp:CommandLine>`,
          }),
        );
        commandId = tagText(started, "CommandId");
        if (!commandId) throw new ConnectorRequestError("WinRM did not start the command");
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        let bytes = 0;
        let finished = false;
        let exitCode: number | null = null;
        for (let i = 0; i < MAX_RECEIVES && !finished; i++) {
          let reply: string;
          try {
            reply = await post(envelope({ to, action: ACTION.receive, shellId, body: `<rsp:Receive><rsp:DesiredStream CommandId="${xml(commandId)}">stdout stderr</rsp:DesiredStream></rsp:Receive>` }));
          } catch (e) {
            // Nothing new within the operation timeout: ask again.
            if ((e as { wsmanCode?: string }).wsmanCode === TIMED_OUT_CODE) continue;
            throw e;
          }
          const part = parseReceive(reply);
          for (const b of [...part.stdout, ...part.stderr]) bytes += b.length;
          if (bytes > MAX_OUTPUT_BYTES) throw new ConnectorRequestError("The script printed more than 20 MB");
          out.push(...part.stdout);
          err.push(...part.stderr);
          finished = part.done;
          exitCode = part.exitCode;
        }
        if (!finished) throw new ConnectorRequestError("The script did not finish in time");
        const result = parseResult(Buffer.concat(out).toString("utf8"));
        if (result) return result;
        const stderr = readableStderr(Buffer.concat(err).toString("utf8"));
        throw new ConnectorRequestError(`The script returned no result (exit code ${exitCode ?? "unknown"})${stderr ? `: ${stderr}` : ""}`);
      } finally {
        if (commandId) {
          await post(
            envelope({ to, action: ACTION.signal, shellId, body: `<rsp:Signal CommandId="${xml(commandId)}"><rsp:Code>${SHELL_URI}/signal/terminate</rsp:Code></rsp:Signal>` }),
          ).catch(() => undefined);
        }
        await post(envelope({ to, action: ACTION.delete, shellId, body: "" })).catch(() => undefined);
      }
    }

    /** A run's records, or the error it reported. */
    async function records(spec: PowerShellSpec, scope: TemplateScope, readOnly: boolean): Promise<unknown[]> {
      const result = await run(spec, scope, readOnly);
      if (!result.ok) {
        const status = result.category === "ObjectNotFound" ? 404 : undefined;
        throw new ConnectorRequestError(`The PowerShell script failed: ${result.error.replace(/\s+/g, " ").slice(0, 300)}`, status);
      }
      return result.output;
    }

    return {
      async test() {
        await records(def.test?.powershell ?? { script: "$PSVersionTable.PSVersion.ToString()" }, { settings }, true);
      },
      async fetch(resource, scope, max, _kind, report) {
        if (!resource.powershell) throw new Error("This resource has no powershell script");
        const output = await records(resource.powershell, scope, true);
        // `records` picks the list in the first output object (a script that returns one object holding it).
        const picked = resource.records === undefined ? output : [resource.records].flat().map((p) => readPath(output.length === 1 ? output[0] : output, p)).find((v) => Array.isArray(v));
        const list = Array.isArray(picked) ? picked : [];
        if (list.length > max && report) report.truncated = true;
        return list.slice(0, max).map((r) => (r && typeof r === "object" ? r : { value: r }));
      },
      async runScript(spec, scope) {
        return records(spec, scope, false);
      },
    };
  };
}

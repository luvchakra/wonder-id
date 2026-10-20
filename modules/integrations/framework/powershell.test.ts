// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BUILTIN_DEFINITIONS } from "./definitions";
import { DefinitionConnector } from "./engine";
import type { FetchLike } from "./http";
import { encodeCommand, normalizeDates, parseFault, parseReceive, parseResult, powershellDriver, readableStderr, wrapScript } from "./drivers/powershell";
import { readOnlyScriptProblem } from "./powershellRules";
import type { ConnectorDefinition } from "./types";
import { validateDefinition } from "./validate";

const b64 = (s: string) => Buffer.from(s).toString("base64");
const framed = (result: unknown) => `<<WONDERID-RESULT>>${b64(JSON.stringify(result))}<<WONDERID-END>>`;

/** A custom definition that exercises every kind of parameter. */
const custom: ConnectorDefinition = {
  schemaVersion: 1,
  key: "acme-ad-scripts",
  version: "1.0.0",
  name: "Acme AD scripts",
  category: "directory",
  description: "Accounts from Active Directory with a search base and a list of properties.",
  driver: "powershell",
  settings: [
    { key: "url", label: "WinRM address", type: "url", required: true },
    { key: "searchBase", label: "Search base", type: "string", required: true },
  ],
  auth: { type: "basic", username: "{secret.username}", password: "{secret.password}", fields: [{ key: "username", label: "User" }, { key: "password", label: "Password" }] },
  test: {},
  resources: {
    account: {
      powershell: {
        script: "param($SearchBase, $Properties, $Limit, $Enabled)\nImport-Module ActiveDirectory\n@{ users = @(Get-ADUser -SearchBase $SearchBase -Filter * -Properties $Properties -ResultSetSize $Limit | Select-Object SamAccountName, Enabled) }",
        parameters: { SearchBase: "OU=Staff,{settings.searchBase}", Properties: ["mail", "department"], Limit: 500, Enabled: true },
        depth: 3,
      },
      records: "users",
      fields: { externalId: "SamAccountName" },
    },
  },
  write: {
    disable_account: { powershell: { script: "param($Who) Disable-ADAccount -Identity $Who", parameters: { Who: "{target.account}" } } },
  },
};

const messages = (def: unknown) => validateDefinition(def).issues.map((i) => `${i.path}: ${i.message}`);
const withAccount = (patch: Record<string, unknown>) => {
  const d = structuredClone(custom) as unknown as { resources: { account: { powershell: Record<string, unknown> } } };
  Object.assign(d.resources.account.powershell, patch);
  return d;
};

describe("powershell: read scripts may only read", () => {
  it.each([
    "Get-LocalUser | Select-Object Name, Enabled",
    "Import-Module ActiveDirectory; Get-ADGroup -Filter * | Sort-Object Name",
    "# Remove-Item is only mentioned here\nGet-Service",
    "Write-Verbose 'Set-ADUser is text'; Get-Process 2>$null",
    "$h = @{ r = 1; sc = 2 }; $h",
    ...BUILTIN_DEFINITIONS.filter((d) => d.driver === "powershell").flatMap((d) => Object.values(d.resources).flatMap((r) => [r].flat().map((s) => s!.powershell!.script))),
  ])("allows %s", (script) => {
    expect(readOnlyScriptProblem(script)).toBeNull();
  });

  it.each([
    ["Get-ADUser bo | Set-ADUser -Enabled $false", /Set-ADUser changes something/],
    ["Get-ChildItem C:\\x | rm", /rm is an alias/],
    ["$c = 'Remove-Item'; & $c C:\\x", /call operator/],
    ["iex 'Get-Date'", /iex is an alias/],
    ['"$(Stop-Service Spooler)"', /Stop-Service changes something/],
    ['Write-Output "#"; Clear-EventLog System', /Clear-EventLog changes something/],
    ["Get-Process | Out-File C:\\p.txt", /writes to a file/],
    ["Get-Process > C:\\p.txt", /writes to a file/],
    ["Disable-LocalUser -Name bo -WhatIf:$false", /Disable-LocalUser/],
    ["Get-Date -WhatIf:$false", /may not change -WhatIf/],
    ["([adsi]'WinNT://./bo').Delete('user', 'bo')", /calls a method/],
    [". $env:TEMP\\x.ps1", /dot-source/],
  ])("refuses %s", (script, why) => {
    expect(readOnlyScriptProblem(script)).toMatch(why);
  });
});

describe("powershell: definitions", () => {
  it("accepts text, list, number and true/false parameters, a records path and a write", () => {
    expect(messages(custom)).toEqual([]);
  });

  it("keeps values out of the script and secrets out of the parameters", () => {
    expect(messages(withAccount({ script: "Get-ADUser -SearchBase '{settings.searchBase}'" })).join()).toMatch(/may not use templates: pass values as parameters/);
    expect(messages(withAccount({ parameters: { Password: "{secret.password}" } })).join()).toMatch(/secrets may only be used in the auth block/);
    expect(messages(withAccount({ parameters: { Params: "x" } })).join()).toMatch(/must be a parameter name/);
    expect(messages(withAccount({ parameters: { Nested: { a: 1 } } })).join()).toMatch(/must be text, a number, true or false, or a list of texts/);
    expect(messages(withAccount({ parameters: { Who: "{target.account}" } })).join()).toMatch(/is not allowed here/);
    expect(messages(withAccount({ depth: 11 })).join()).toMatch(/depth: must be a whole number from 1 to 10/);
  });

  it("needs a change to name its target, an https address and Basic sign-in", () => {
    const d = structuredClone(custom);
    d.write = { disable_account: { powershell: { script: "Disable-ADAccount -Identity bo" } } };
    expect(messages(d).join()).toMatch(/must pass \{target\.account\}/);
    expect(messages({ ...custom, auth: { type: "bearer", token: "{secret.t}", fields: [{ key: "t", label: "T" }] } }).join()).toMatch(/auth.type: must be one of basic/);
    expect(messages({ ...custom, settings: [] }).join()).toMatch(/needs a url setting/);
  });
});

describe("powershell: the wire format", () => {
  it("sends parameters as base64 data, never in the script's text", () => {
    const hostile = "x'; Remove-Item C:\\ -Recurse; '";
    const ps = wrapScript({ script: "param($Name) $Name" }, { Name: hostile }, true);
    expect(ps).not.toContain(hostile);
    expect(ps).toContain(b64(JSON.stringify({ Name: hostile })));
    expect(ps).toContain("$WhatIfPreference = $true");
    expect(wrapScript({ script: "1", depth: 2 }, {}, false)).not.toContain("$WhatIfPreference = $true");
    expect(wrapScript({ script: "1", depth: 2 }, {}, false)).toContain("-Depth 3");
    expect(Buffer.from(encodeCommand("Get-Date"), "base64").toString("utf16le")).toBe("Get-Date");
  });

  it("reads the framed result and nothing else the script printed", () => {
    expect(parseResult(`hello\n${framed({ ok: true, output: { a: "/Date(0)/" } })}\n`)).toEqual({ ok: true, output: [{ a: "1970-01-01T00:00:00.000Z" }] });
    expect(parseResult(framed({ ok: true, output: null }))).toEqual({ ok: true, output: [] });
    expect(parseResult(framed({ ok: false, error: "Cannot find", category: "ObjectNotFound", errorId: "E" }))).toMatchObject({ ok: false, category: "ObjectNotFound" });
    expect(parseResult("no result here")).toBeNull();
    expect(normalizeDates(["/Date(1000+0530)/", "x"])).toEqual(["1970-01-01T00:00:01.000Z", "x"]);
  });

  it("reads WinRM streams, command state and faults", () => {
    const reply = `<rsp:Stream Name="stdout" CommandId="C">${b64("out")}</rsp:Stream><rsp:Stream Name="stderr" CommandId="C">${b64("err")}</rsp:Stream><rsp:Stream Name="stdout" CommandId="C" End="true"/><rsp:CommandState CommandId="C" State="http://schemas.microsoft.com/wbem/wsman/1/windows/shell/CommandState/Done"><rsp:ExitCode>1</rsp:ExitCode></rsp:CommandState>`;
    const r = parseReceive(reply);
    expect([Buffer.concat(r.stdout).toString(), Buffer.concat(r.stderr).toString(), r.done, r.exitCode]).toEqual(["out", "err", true, 1]);
    expect(parseReceive(`<rsp:Stream Name="stdout">${b64("x")}</rsp:Stream>`).done).toBe(false);
    expect(parseFault(`<s:Fault><s:Reason><s:Text>Access is denied.</s:Text></s:Reason><f:WSManFault Code="5"><f:Message>Access &amp; denied.</f:Message></f:WSManFault></s:Fault>`)).toEqual({ message: "Access & denied.", code: "5" });
    expect(parseFault("<rsp:Shell/>")).toBeNull();
    expect(readableStderr('#< CLIXML\r\n<Objs><S S="Error">Get-Foo : not found_x000D__x000A_</S></Objs>')).toBe("Get-Foo : not found");
  });
});

describe("powershell: the driver", () => {
  /** One script run's stdout, whatever the script. */
  const server = (stdout: string, stderr = "") => {
    const actions: string[] = [];
    const fetch: FetchLike = async (_url, init) => {
      const action = /<a:Action[^>]*>[^<]*\/(\w+)<\/a:Action>/.exec(init.body ?? "")![1];
      actions.push(action);
      const body =
        action === "Create"
          ? `<w:Selector Name="ShellId">S1</w:Selector>`
          : action === "Command"
            ? `<rsp:CommandId>C1</rsp:CommandId>`
            : action === "Receive"
              ? `<rsp:Stream Name="stdout">${b64(stdout)}</rsp:Stream><rsp:Stream Name="stderr">${b64(stderr)}</rsp:Stream><rsp:CommandState State="http://schemas.microsoft.com/wbem/wsman/1/windows/shell/CommandState/Done"><rsp:ExitCode>1</rsp:ExitCode></rsp:CommandState>`
              : "";
      return new Response(`<s:Envelope><s:Body>${body}</s:Body></s:Envelope>`);
    };
    return { fetch, actions };
  };
  const connect = async (fetch: FetchLike, def: ConnectorDefinition = custom) => {
    const c = new DefinitionConnector({ powershell: powershellDriver(fetch) });
    await c.authenticate({ definition: { key: def.key, version: def.version, origin: "custom" }, manifest: def, settings: { url: "https://dc.example.test:5986/wsman", searchBase: "DC=example,DC=test" } }, JSON.stringify({ username: "u", password: "p" }));
    return c;
  };

  it("picks the records list from the script's one output object", async () => {
    const c = await connect(server(framed({ ok: true, output: { users: [{ SamAccountName: "ana" }, { SamAccountName: "bo" }] } })).fetch);
    expect((await c.importKind("account")).map((r) => r.externalId)).toEqual(["ana", "bo"]);
  });

  it("an object-not-found error reads as none for an optional resource", async () => {
    const def = structuredClone(custom);
    (def.resources.account as { optional?: boolean }).optional = true;
    const c = await connect(server(framed({ ok: false, error: "Directory object not found", category: "ObjectNotFound", errorId: "E" })).fetch, def);
    expect(await c.importKind("account")).toEqual([]);
  });

  it("says what went wrong when the script returns no result, and still closes the shell", async () => {
    const s = server("", '#< CLIXML\r\n<Objs><S S="Error">The term \'Get-ADUser\' is not recognized_x000D__x000A_</S></Objs>');
    const c = await connect(s.fetch);
    await expect(c.importKind("account")).rejects.toThrow(/returned no result \(exit code 1\): The term 'Get-ADUser' is not recognized/);
    expect(s.actions.slice(-2)).toEqual(["Signal", "Delete"]);
  });

  it("refuses a script too long for the Windows command line before sending anything", async () => {
    const s = server(framed({ ok: true, output: [] }));
    const def = structuredClone(custom);
    (def.resources.account as { powershell: { parameters: Record<string, unknown> } }).powershell.parameters = { SearchBase: "x".repeat(2000), Properties: Array(40).fill("y".repeat(200)) };
    const c = await connect(s.fetch, def);
    await expect(c.importKind("account")).rejects.toThrow(/too long to send/);
    expect(s.actions).toEqual([]);
  });

  it("runs a change without -WhatIf and fails it on an error the script throws", async () => {
    const c = await connect(server(framed({ ok: false, error: "Access is denied", category: "PermissionDenied", errorId: "E" })).fetch);
    await expect(c.write("disable_account", { account: "bo" }, "k1")).rejects.toThrow(/The PowerShell script failed: Access is denied/);
  });
});

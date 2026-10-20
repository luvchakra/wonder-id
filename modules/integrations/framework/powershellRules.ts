/**
 * Checks for the powershell driver's scripts (validate.ts uses them).
 *
 * A read script must only read (non-negotiable #12). This is a guard
 * against a script that changes something by mistake, not a sandbox: the
 * account the connection signs in with should hold only the rights it
 * reads with, and reads also run with -WhatIf on (drivers/powershell.ts).
 * Comments and single-quoted text are ignored; double-quoted text is
 * checked too, since `"$(…)"` runs what it holds.
 */

export const MAX_SCRIPT_LENGTH = 8_000;
export const PARAMETER_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
/** Names the wrapper itself uses. */
export const RESERVED_PARAMETERS = new Set(["params", "args", "input", "_", "this"]);

/** Verbs of commands that change something. */
const CHANGING_VERBS =
  "Add|Approve|Backup|Block|Clear|Close|Connect|Copy|Deny|Disable|Disconnect|Dismount|Enable|Enter|Export|Grant|Import|Initialize|Install|Invoke|Lock|Mount|Move|New|Open|Protect|Publish|Push|Register|Remove|Rename|Repair|Reset|Resize|Restart|Restore|Resume|Revoke|Save|Send|Set|Start|Stop|Submit|Suspend|Sync|Unblock|Uninstall|Unlock|Unprotect|Unpublish|Unregister|Update|Use";

/** Commands with those verbs that only load, read or write to the console. */
const ALLOWED_COMMANDS = new Set(["import-module", "import-csv", "import-clixml", "import-powershelldatafile", "out-string", "out-null", "write-output", "write-verbose", "write-debug", "write-warning", "write-information", "write-host"]);

/** Built-in aliases of changing commands, at a command position. */
const CHANGING_ALIASES =
  "ac|clc|clhy|cli|clp|clv|cp|cpi|cpp|del|epal|epcsv|erase|iex|icm|ihy|ipal|ipcsv|kill|md|mi|mkdir|mount|move|mp|mv|ni|nmo|nsn|nv|r|rd|ren|ri|rm|rmdir|rni|rnp|rp|rv|rvpa|sajb|sal|saps|sasv|sc|si|sl|sp|spjb|spps|spsv|start|sv";

/** The script with comments and single-quoted text blanked out; double-quoted text kept. */
export function scriptCode(script: string): string {
  return script.replace(/<#[\s\S]*?#>|@'[\s\S]*?'@|@"[\s\S]*?"@|"(?:[^"`]|`[\s\S])*"|'(?:[^']|'')*'|#[^\n]*/g, (m) => (m.startsWith('"') || m.startsWith('@"') ? m : " "));
}

/** Why a read script might change something, or null when it only reads. */
export function readOnlyScriptProblem(script: string): string | null {
  const code = scriptCode(script);
  for (const m of code.matchAll(new RegExp(`\\b((?:${CHANGING_VERBS})-[A-Za-z][\\w]*)`, "gi"))) {
    if (!ALLOWED_COMMANDS.has(m[1].toLowerCase())) return `may only read: ${m[1]} changes something (writes belong under write)`;
  }
  const alias = new RegExp(`(?:^|[;|{}(\\n]|&&|\\|\\|)\\s*(${CHANGING_ALIASES})(?=\\s|$|;|\\))(?!\\s*=)`, "im").exec(code);
  if (alias) return `may only read: ${alias[1]} is an alias of a command that changes something`;
  // A command named at run time could be anything.
  if (/&(?!&)/.test(code.replace(/&&/g, ""))) return "may not use the call operator (&): name each command";
  if (/(?:^|[;|{(\n])\s*\.\s+[$"'(]/m.test(code)) return "may not dot-source a script";
  if (/\bAdd-Type\b|\[scriptblock\]|::Create\s*\(|\.Invoke(?:Member|Command|Script)?\s*\(|\bInvokeCommand\b|\.(?:SetInfo|Put|Delete|DeleteTree|CommitChanges|MoveTo|Rename)\s*\(/i.test(code)) {
    return "may only read: it calls a method or type that can run or change anything";
  }
  if (/\$WhatIfPreference|PSDefaultParameterValues|-WhatIf\s*:/i.test(code)) return "may not change -WhatIf: reads run with it on";
  if (/(?<![\w-])>>?\s*(?!\$null\b|&)\S|\b(?:Out-File|Tee-Object)\b/i.test(code)) return "may only read: it writes to a file";
  return null;
}

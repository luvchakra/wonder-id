import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { CONFIG_SETTINGS, type ConfigValue, type TenantConfig } from "./registry";

/**
 * PLATFORM-P0-13 (finish) — configuration bundles: an organization's Global
 * Configuration as a signed file, so the settings tried in Dev or Test can be
 * moved to another environment and checked before they are applied.
 *
 * The signature is an HMAC-SHA256 keyed from SECRET_ENCRYPTION_KEY (a
 * retired SECRET_ENCRYPTION_KEY_PREVIOUS still verifies). It proves the file
 * was exported by this WonderID and not edited since; it is not bound to an
 * organization, because a bundle moves between an organization's
 * environments, which are separate organizations. Importing still checks
 * every setting and its permission, as a save does (§17.5: nothing
 * part-applied). Without a key nothing is signed or accepted.
 */

export const BUNDLE_FORMAT = "wonderid-config-bundle";
// Version 2 adds the identity attributes; a version 1 file (settings only)
// is still read.
const BUNDLE_VERSION = 2;
const READABLE_VERSIONS = [1, 2];

export type BundleSource = { organization: string; environment: string | null };

/** An identity attribute as the file carries it (IDENTITY-P0-16's definition, without ids). */
export type BundleAttribute = {
  identityType: string | null;
  name: string;
  displayName: string;
  dataType: string;
  required: boolean;
  sensitive: boolean;
  searchable: boolean;
  uniqueValue: boolean;
  allowedValues: string[];
  validationRegex: string | null;
  sourceMapping: string | null;
  active: boolean;
};

const ATTRIBUTE_FIELDS = ["identityType", "name", "displayName", "dataType", "required", "sensitive", "searchable", "uniqueValue", "allowedValues", "validationRegex", "sourceMapping", "active"] as const satisfies readonly (keyof BundleAttribute)[];
const MAX_ATTRIBUTES = 500;

export type ConfigBundle = {
  format: typeof BUNDLE_FORMAT;
  version: number;
  exportedAt: string;
  source: BundleSource;
  settings: Record<string, ConfigValue>;
  /** Version 2 and later. */
  attributes?: BundleAttribute[];
  signature: string;
};

function keys(): Buffer[] {
  return [process.env.SECRET_ENCRYPTION_KEY ?? "", ...(process.env.SECRET_ENCRYPTION_KEY_PREVIOUS ?? "").split(",")]
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => createHash("sha256").update(`wonderid-config-bundle:${k}`, "utf8").digest());
}

const attributeKey = (a: Pick<BundleAttribute, "identityType" | "name">) => `${a.identityType ?? "*"}:${a.name}`;

/** The signed fields, in one fixed order, so the signature does not depend on key or list order. */
function canonical(b: Omit<ConfigBundle, "signature">): string {
  const settings = Object.fromEntries(Object.keys(b.settings).sort().map((k) => [k, b.settings[k]]));
  const head = [b.format, b.version, b.exportedAt, b.source.organization, b.source.environment, settings];
  if (b.version === 1) return JSON.stringify(head);
  const attributes = [...(b.attributes ?? [])].sort((x, y) => attributeKey(x).localeCompare(attributeKey(y))).map((a) => ATTRIBUTE_FIELDS.map((f) => a[f]));
  return JSON.stringify([...head, attributes]);
}

const sign = (key: Buffer, body: string) => createHmac("sha256", key).update(body, "utf8").digest("hex");

/** The organization's settings and identity attributes as a signed bundle, or null when the server has no key to sign with. */
export function exportConfigBundle(config: TenantConfig, source: BundleSource, attributes: BundleAttribute[], now = new Date()): ConfigBundle | null {
  const [key] = keys();
  if (!key) return null;
  const settings = Object.fromEntries(CONFIG_SETTINGS.map((s) => [s.key, config[s.key as keyof TenantConfig] as ConfigValue]));
  const body: Omit<ConfigBundle, "signature"> = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: now.toISOString(),
    source,
    settings,
    attributes: attributes.map((a) => Object.fromEntries(ATTRIBUTE_FIELDS.map((f) => [f, a[f]])) as BundleAttribute),
  };
  return { ...body, signature: sign(key, canonical(body)) };
}

export type ReadBundleResult = { ok: true; bundle: ConfigBundle } | { ok: false; message: string };

const MAX_BYTES = 64 * 1024;

/** Parses and verifies a bundle file. Its settings are checked later, by the save. */
export function readConfigBundle(text: string): ReadBundleResult {
  if (!text.trim()) return { ok: false, message: "Choose a configuration file." };
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) return { ok: false, message: "That file is too large to be a configuration file." };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "That file is not a WonderID configuration file." };
  }
  const b = raw as Partial<ConfigBundle> | null;
  if (!b || typeof b !== "object" || b.format !== BUNDLE_FORMAT) return { ok: false, message: "That file is not a WonderID configuration file." };
  if (typeof b.version !== "number" || !READABLE_VERSIONS.includes(b.version)) return { ok: false, message: "That configuration file comes from a different version of WonderID." };
  if (
    typeof b.exportedAt !== "string" ||
    !b.source ||
    typeof b.source.organization !== "string" ||
    !(b.source.environment === null || typeof b.source.environment === "string") ||
    !b.settings ||
    typeof b.settings !== "object" ||
    Array.isArray(b.settings) ||
    typeof b.signature !== "string" ||
    !/^[0-9a-f]{64}$/.test(b.signature) ||
    (b.version >= 2 && !wellFormedAttributes(b.attributes))
  ) {
    return { ok: false, message: "That configuration file is incomplete." };
  }
  const bundle = b as ConfigBundle;
  const body = canonical({ format: bundle.format, version: bundle.version, exportedAt: bundle.exportedAt, source: bundle.source, settings: bundle.settings, attributes: bundle.attributes });
  const want = Buffer.from(bundle.signature, "hex");
  const all = keys();
  if (!all.length) return { ok: false, message: "This server cannot check configuration files. Nothing was imported." };
  const valid = all.some((key) => {
    const got = Buffer.from(sign(key, body), "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  });
  if (!valid) return { ok: false, message: "That configuration file was changed after it was exported, or comes from another WonderID. Nothing was imported." };
  return { ok: true, bundle };
}

/** Shape only; the Identity module validates each definition before anything is imported. */
function wellFormedAttributes(list: unknown): list is BundleAttribute[] {
  if (!Array.isArray(list) || list.length > MAX_ATTRIBUTES) return false;
  return list.every(
    (a) =>
      !!a &&
      typeof a === "object" &&
      (a.identityType === null || typeof a.identityType === "string") &&
      typeof a.name === "string" &&
      typeof a.displayName === "string" &&
      typeof a.dataType === "string" &&
      ["required", "sensitive", "searchable", "uniqueValue", "active"].every((f) => typeof a[f] === "boolean") &&
      Array.isArray(a.allowedValues) &&
      a.allowedValues.every((v: unknown) => typeof v === "string") &&
      (a.validationRegex === null || typeof a.validationRegex === "string") &&
      (a.sourceMapping === null || typeof a.sourceMapping === "string"),
  );
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { exportConfigBundle, readConfigBundle, type BundleAttribute } from "./bundle";
import { DEFAULT_CONFIG } from "./registry";

const source = { organization: "acme-dev", environment: "dev" };
const costCentre: BundleAttribute = { identityType: "HUMAN", name: "cost_centre", displayName: "Cost centre", dataType: "string", required: false, sensitive: false, searchable: true, uniqueValue: false, allowedValues: [], validationRegex: "^[0-9]{4}$", sourceMapping: null, active: true };
const region: BundleAttribute = { ...costCentre, identityType: null, name: "region", displayName: "Region", dataType: "enum", allowedValues: ["EU", "US"], validationRegex: null };

describe("PLATFORM-P0-13: configuration bundles", () => {
  beforeEach(() => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "current-key");
    vi.stubEnv("SECRET_ENCRYPTION_KEY_PREVIOUS", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("exports every setting, signed, and reads it back", () => {
    const bundle = exportConfigBundle({ ...DEFAULT_CONFIG, "access.dormantDays": 180 } as typeof DEFAULT_CONFIG, source, [costCentre], new Date("2026-10-17T08:00:00Z"))!;
    expect(bundle.settings["access.dormantDays"]).toBe(180);
    expect(Object.keys(bundle.settings).length).toBe(Object.keys(DEFAULT_CONFIG).length);
    const read = readConfigBundle(JSON.stringify(bundle));
    expect(read).toEqual({ ok: true, bundle });
  });

  it("refuses a file changed after export, whatever the key order", () => {
    const bundle = exportConfigBundle(DEFAULT_CONFIG, source, [])!;
    const reordered = JSON.parse(JSON.stringify(bundle));
    reordered.settings = Object.fromEntries(Object.entries(reordered.settings).reverse());
    expect(readConfigBundle(JSON.stringify(reordered)).ok).toBe(true);
    const edited = { ...bundle, settings: { ...bundle.settings, "access.dormantDays": 30 } };
    expect(readConfigBundle(JSON.stringify(edited))).toMatchObject({ ok: false, message: expect.stringMatching(/changed after it was exported/) });
    const moved = { ...bundle, source: { organization: "other", environment: null } };
    expect(readConfigBundle(JSON.stringify(moved)).ok).toBe(false);
  });

  it("still accepts a file signed with a retired key, and refuses another server's", () => {
    const old = exportConfigBundle(DEFAULT_CONFIG, source, [])!;
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "new-key");
    vi.stubEnv("SECRET_ENCRYPTION_KEY_PREVIOUS", "current-key");
    expect(readConfigBundle(JSON.stringify(old)).ok).toBe(true);
    vi.stubEnv("SECRET_ENCRYPTION_KEY_PREVIOUS", "");
    expect(readConfigBundle(JSON.stringify(old)).ok).toBe(false);
  });

  it("signs and accepts nothing without a key", () => {
    const bundle = exportConfigBundle(DEFAULT_CONFIG, source, [])!;
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "");
    expect(exportConfigBundle(DEFAULT_CONFIG, source, [])).toBeNull();
    expect(readConfigBundle(JSON.stringify(bundle))).toMatchObject({ ok: false, message: expect.stringMatching(/cannot check/) });
  });

  it("refuses what is not a bundle", () => {
    expect(readConfigBundle("").ok).toBe(false);
    expect(readConfigBundle("not json").ok).toBe(false);
    expect(readConfigBundle(JSON.stringify({ format: "other" })).ok).toBe(false);
    expect(readConfigBundle(JSON.stringify({ format: "wonderid-config-bundle", version: 3 }))).toMatchObject({ ok: false, message: expect.stringMatching(/different version/) });
    expect(readConfigBundle(JSON.stringify({ format: "wonderid-config-bundle", version: 1, settings: [] }))).toMatchObject({ ok: false, message: expect.stringMatching(/incomplete/) });
    expect(readConfigBundle("x".repeat(70 * 1024)).ok).toBe(false);
  });

  it("carries the identity attributes, signed in any order; an edited attribute is refused", () => {
    const bundle = exportConfigBundle(DEFAULT_CONFIG, source, [costCentre, region])!;
    expect(bundle.version).toBe(2);
    expect(bundle.attributes).toEqual([costCentre, region]);
    expect(readConfigBundle(JSON.stringify({ ...bundle, attributes: [region, costCentre] })).ok).toBe(true);
    const edited = { ...bundle, attributes: [{ ...costCentre, sensitive: true }, region] };
    expect(readConfigBundle(JSON.stringify(edited))).toMatchObject({ ok: false, message: expect.stringMatching(/changed after it was exported/) });
    const dropped = { ...bundle, attributes: [region] };
    expect(readConfigBundle(JSON.stringify(dropped)).ok).toBe(false);
    expect(readConfigBundle(JSON.stringify({ ...bundle, attributes: [{ ...costCentre, active: "yes" }] }))).toMatchObject({ ok: false, message: expect.stringMatching(/incomplete/) });
    expect(readConfigBundle(JSON.stringify({ ...bundle, attributes: undefined }))).toMatchObject({ ok: false, message: expect.stringMatching(/incomplete/) });
  });

  it("still reads a version 1 file (settings only)", () => {
    const body = { format: "wonderid-config-bundle", version: 1, exportedAt: "2026-10-17T08:00:00.000Z", source, settings: { "access.dormantDays": 90 } };
    const key = createHash("sha256").update("wonderid-config-bundle:current-key", "utf8").digest();
    const signature = createHmac("sha256", key).update(JSON.stringify([body.format, body.version, body.exportedAt, source.organization, source.environment, body.settings]), "utf8").digest("hex");
    const read = readConfigBundle(JSON.stringify({ ...body, signature }));
    expect(read.ok).toBe(true);
    expect(read.ok && read.bundle.attributes).toBeUndefined();
  });
});

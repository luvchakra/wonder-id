import { describe, expect, it } from "vitest";
import { checkSmtpSettings, presetForHost, SMTP_PRESETS, smtpFrom } from "./smtpRules";

const valid = { host: "smtpout.secureserver.net", security: "ssl", port: "465", username: "connect@example.com", password: "secret", fromEmail: "connect@example.com", fromName: "Example IT", enabled: "on" };

describe("checkSmtpSettings (owner test feedback item 14)", () => {
  it("accepts a GoDaddy-style SSL server", () => {
    const r = checkSmtpSettings(valid, false);
    expect(r).toEqual({ ok: true, value: { enabled: true, host: "smtpout.secureserver.net", port: 465, security: "ssl", username: "connect@example.com", password: "secret", fromEmail: "connect@example.com", fromName: "Example IT" } });
  });

  it("uses the security's default port when none is given", () => {
    const r = checkSmtpSettings({ ...valid, security: "starttls", port: "" }, false);
    expect(r.ok && r.value.port).toBe(587);
  });

  it("refuses an unknown security (no plain-text SMTP)", () => {
    const r = checkSmtpSettings({ ...valid, security: "none" }, false);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.security).toBeTruthy();
  });

  it("refuses a host that is not a host name and a port out of range", () => {
    const r = checkSmtpSettings({ ...valid, host: "smtp://evil host", port: "70000" }, false);
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(["host", "port"]);
  });

  it("needs a password for a user name unless one is stored", () => {
    expect(checkSmtpSettings({ ...valid, password: "" }, false).ok).toBe(false);
    const kept = checkSmtpSettings({ ...valid, password: "" }, true);
    expect(kept.ok && kept.value.password).toBeNull();
  });

  it("allows a server without sign-in", () => {
    const r = checkSmtpSettings({ ...valid, username: "", password: "" }, false);
    expect(r.ok && r.value.username).toBeNull();
  });

  it("refuses a bad from address and turns off when unchecked", () => {
    expect(checkSmtpSettings({ ...valid, fromEmail: "not-an-address" }, false).ok).toBe(false);
    const off = checkSmtpSettings({ ...valid, enabled: undefined }, false);
    expect(off.ok && off.value.enabled).toBe(false);
  });

  it("strips characters that could break the From header", () => {
    const r = checkSmtpSettings({ ...valid, fromName: 'Evil"\r\nBcc: x@y.z<' }, false);
    expect(r.ok && r.value.fromName).toBe("EvilBcc: x@y.z");
    expect(smtpFrom("a@b.example", "Acme")).toBe('"Acme" <a@b.example>');
    expect(smtpFrom("a@b.example", null)).toBe("a@b.example");
  });
});

describe("provider presets", () => {
  it("each preset is a valid server", () => {
    for (const p of SMTP_PRESETS) {
      const r = checkSmtpSettings({ host: p.host, security: p.security, port: String(p.port), fromEmail: "a@b.co", enabled: "on" }, false);
      expect(r.ok, p.id).toBe(true);
    }
  });

  it("matches a saved server by host", () => {
    expect(presetForHost(" SMTP.gmail.com ")?.id).toBe("gmail");
    expect(presetForHost("mail.example.com")).toBeNull();
    expect(presetForHost(null)).toBeNull();
  });
});

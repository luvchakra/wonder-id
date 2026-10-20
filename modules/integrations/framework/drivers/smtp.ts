import "server-only";

import { createTransport } from "nodemailer";
import { resolveSafeHost } from "./net";

/**
 * The smtp driver (owner test feedback item 14, 2026-10-20): sends one
 * message through an organization's own outgoing mail server. It lives in
 * the framework because that server is the organization's system
 * (non-negotiable #20). TLS only: implicit TLS ("ssl", usually 465) or
 * STARTTLS that must succeed ("starttls", usually 587), so a password never
 * crosses the network in the clear. The host passes the same SSRF guard as
 * the LDAP and SQL drivers, and the certificate is still checked against
 * the host name.
 */

export type SmtpServer = {
  host: string;
  port: number;
  security: "ssl" | "starttls";
  username: string | null;
  password: string | null;
};

export type SmtpMessage = { from: string; to: string; subject: string; text: string };

export async function sendSmtpMail(server: SmtpServer, message: SmtpMessage): Promise<void> {
  const address = await resolveSafeHost(server.host);
  const servername = /^[\d.]+$|:/.test(server.host) ? undefined : server.host;
  const transport = createTransport({
    host: address,
    port: server.port,
    secure: server.security === "ssl",
    requireTLS: server.security === "starttls",
    auth: server.username ? { user: server.username, pass: server.password ?? "" } : undefined,
    tls: { servername, rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await transport.sendMail(message);
  } finally {
    transport.close();
  }
}

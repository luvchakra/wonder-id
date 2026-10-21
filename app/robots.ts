import type { MetadataRoute } from "next";

/**
 * robots.txt (owner request 2026-10-21, AI reverse-engineering hardening).
 * Search engines may index the marketing page only; everything behind
 * sign-in, the API and the help guide is off limits, and AI training and
 * answer crawlers are refused the whole site. robots.txt is a request
 * honest crawlers follow, not access control: every page still needs a
 * session (proxy.ts), and the edge firewall handles the rest.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "CCBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "Amazonbot",
  "meta-externalagent",
  "FacebookBot",
  "cohere-ai",
  "Diffbot",
  "YouBot",
  "Timpibot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: AI_CRAWLERS, disallow: "/" },
      { userAgent: "*", allow: ["/$", "/welcome"], disallow: "/" },
    ],
  };
}

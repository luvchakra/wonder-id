# WonderID terms: draft clauses for legal review

**Status: draft, not published.** Written 21 October 2026 as part of the AI
reverse-engineering hardening. A lawyer must review and adapt these clauses
before they appear in the product or are accepted by anyone. Until then they
have no effect.

Once reviewed, the plan is:

- publish the Terms of Service and Acceptable Use Policy at public pages;
- add a required "I agree" checkbox at sign-up;
- store the accepted version and time per person.

## Acceptable use and restrictions

You may use WonderID only for your organization's own identity governance,
and only as these terms allow. You must not, and must not let anyone else:

1. **Reverse engineer** the service. This means decompiling, disassembling or
   otherwise trying to derive its source code, algorithms, models, scoring or
   rules. It also covers its data structures and how its features work
   internally, except where the law allows it despite this clause.
2. **Copy or imitate** the service, its screens, workflows, documentation or
   help content to build, train or improve a product or service that competes
   with WonderID.
3. **Use automated access.** No bots, crawlers, scrapers, headless browsers or AI
   agents may read, collect or copy content from the service at scale. This
   doesn't cover the documented API used through an automation credential
   WonderID issued to you, within its limits.
4. **Train AI models.** Don't use the service, its output or its documentation
   to train, fine-tune, evaluate or prompt an AI model whose output describes,
   reproduces or competes with the service.
5. **Get around limits or protections.** Don't bypass rate limits, usage limits,
   access controls or security measures, or probe or scan the service for
   weaknesses without written permission. Report weaknesses through
   `/.well-known/security.txt`.
6. **Share access.** Don't share accounts, or give access to the service or its
   documentation to a competitor or anyone acting for one.
7. **Remove notices.** Don't remove or hide proprietary, copyright or watermark
   notices, including those on exports and reports.

## Ownership

WonderID and everything in it remain the property of its owner and
licensors. This covers the software, design, documentation, help content
and the scoring and policy logic. Your organization's data remains yours.
These terms grant a limited, non-exclusive, non-transferable right to use the
service during the subscription. No other rights are granted.

## Monitoring and enforcement

WonderID monitors use of the service to protect it, including request rates,
exports and automated access. If we reasonably believe an account breaches
this section, we may throttle, suspend or end it. Where we can, we give
notice first. We may also take legal action. Breaching this section is a
material breach of the agreement.

## Open questions for the reviewer

- Governing law and courts (India, or the customer's country for enterprise
  contracts).
- How the reverse-engineering clause interacts with statutory rights in the
  EU (Software Directive art. 6) and elsewhere.
- Whether trial and free accounts get stricter terms than paid ones.
- Whether to require click-through acceptance by existing members on their
  next sign-in.

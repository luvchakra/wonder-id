import { MarketingChrome } from "./MarketingChrome";

/**
 * Public marketing chrome. Deliberately separate from the authenticated
 * `(customer)` shell: no nav drawer, no tenant switcher, no session — this
 * layout renders for signed-out visitors, so it must never call
 * getTenantContext() or anything that assumes a user.
 */
export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
  return <MarketingChrome>{children}</MarketingChrome>;
}

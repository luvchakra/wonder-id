import type { Metadata } from "next";
import { MarketingChrome } from "@/app/welcome/MarketingChrome";

export const metadata: Metadata = {
  title: { absolute: "Careers · WonderID" },
  description: "Open positions at WonderID: help govern every identity — people, partners, machines and AI agents.",
  robots: { index: true, follow: true },
};

/** WonderID's careers pages: public, signed out, in the landing page's frame. */
export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return <MarketingChrome onCareers>{children}</MarketingChrome>;
}

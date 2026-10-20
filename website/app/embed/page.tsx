import type { Metadata } from "next";
import { LiveDemo } from "@/components/landing/live-demo";
import { demoSources } from "@/lib/demo-source";
import { EmbedBridge } from "./embed-bridge";

/*
 * The hero's live demo by itself, for other sites to put in an iframe (ashishalex.com does).
 * The header and footer are left out (app/components/hide-on-embed.tsx). The page tells its parent
 * how tall it is, and takes its theme from the parent. Not linked from anywhere.
 */
export const metadata: Metadata = { title: "Live demo", robots: { index: false, follow: false } };

export default function EmbedPage() {
  return (
    <main className="flex-1 p-px">
      <EmbedBridge />
      <LiveDemo sources={demoSources()} />
    </main>
  );
}

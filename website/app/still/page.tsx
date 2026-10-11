import type { Metadata } from "next";
import { LiveDemo } from "@/components/landing/live-demo";
import { deferSource, demoSources, diagnosticsSource } from "@/lib/demo-source";

/*
 * One frame of the live demo by itself: what `just website-demo` takes the README's pictures of
 * (scripts/demo/stills.mjs). 1200px wide with the source file, 720px wide with the panel alone. Not linked from anywhere.
 */
export const metadata: Metadata = { title: "Still", robots: { index: false, follow: false } };

export default async function StillPage({ searchParams }: { searchParams: Promise<{ frame?: string; panel?: string }> }) {
  const { frame, panel } = await searchParams;
  const sources = frame === "errors" ? [diagnosticsSource()] : frame === "defer" ? [deferSource()] : demoSources();
  return (
    <main className="flex-1 p-8">
      <div id="still" className={panel ? "w-[720px]" : "w-[1200px]"}>
        <LiveDemo sources={sources} still panelOnly={Boolean(panel)} />
      </div>
    </main>
  );
}

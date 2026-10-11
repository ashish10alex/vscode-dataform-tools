import type { Metadata } from "next";
import { LiveDemo } from "@/components/landing/live-demo";
import { demoSources, diagnosticsSource } from "@/lib/demo-source";

/*
 * One frame of the live demo by itself, 1200px wide: what `just website-demo` takes the README's pictures of
 * (scripts/demo/stills.mjs). Not linked from anywhere.
 */
export const metadata: Metadata = { title: "Still", robots: { index: false, follow: false } };

export default async function StillPage({ searchParams }: { searchParams: Promise<{ frame?: string }> }) {
  const { frame } = await searchParams;
  return (
    <main className="flex-1 p-8">
      <div id="still" className="w-[1200px]">
        <LiveDemo sources={frame === "errors" ? [diagnosticsSource()] : demoSources()} still />
      </div>
    </main>
  );
}

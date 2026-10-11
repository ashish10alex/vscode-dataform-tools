import { Hero } from "@/components/landing/hero";
import { TrustStrip } from "@/components/landing/trust-strip";
import { ReleaseHighlight } from "@/components/landing/release-highlight";
import { FeatureSpotlight } from "@/components/landing/feature-spotlight";
import { RecentlyShipped } from "@/components/landing/recently-shipped";
import { AboutAuthor } from "@/components/landing/about-author";
import { InspectorDemo } from "@/components/landing/inspector-demo";
import { LiveDemo } from "@/components/landing/live-demo";
import { diagnosticsSource } from "@/lib/demo-source";

export default function Home() {
  return (
    <main className="flex-1">
      <Hero />
      <TrustStrip />
      <ReleaseHighlight />
      <FeatureSpotlight
        theme="compile"
        index={1}
        heading="Errors, before anything runs"
        blurb="A dry run checks every save against BigQuery. What it rejects is marked on the line you wrote, listed in Problems and told in the panel. This file has one: it is the real panel again."
        demo={<LiveDemo sources={[diagnosticsSource()]} />}
      />
      <FeatureSpotlight
        theme="graph"
        index={2}
        heading="Find where a row went missing"
        blurb="The dependency inspector takes a model and everything it reads from, and runs one filter on all of them. The row counts on the graph show which step lost the row. Press Run All: this is the real inspector, on the model above."
        demo={<InspectorDemo />}
      />
      <RecentlyShipped />
      <AboutAuthor />
    </main>
  );
}

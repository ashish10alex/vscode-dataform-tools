import { Hero } from "@/components/landing/hero";
import { TrustStrip } from "@/components/landing/trust-strip";
import { ReleaseHighlight } from "@/components/landing/release-highlight";
import { FeatureSpotlight } from "@/components/landing/feature-spotlight";
import { RecentlyShipped } from "@/components/landing/recently-shipped";
import { AboutAuthor } from "@/components/landing/about-author";
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
        slides={[
          {
            label: "Dependency graph",
            title: "Dependency graph",
            media: { light: "/dependancy_tree_light.png", dark: "/dependancy_tree_dark.png" },
            alt: "Interactive dependency graph with external sources highlighted",
          },
          {
            label: "Dependency inspector",
            title: "Dependency inspector",
            media: { light: "/dependency_inspector_one.png", dark: "/dependency_inspector_one.png" },
            alt: "Dependency inspector running a filtered query across a model and its upstream dependencies",
          },
        ]}
        reverse
      />
      <RecentlyShipped />
      <AboutAuthor />
    </main>
  );
}

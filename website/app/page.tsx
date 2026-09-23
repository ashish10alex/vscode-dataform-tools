import { Hero } from "@/components/landing/hero";
import { TrustStrip } from "@/components/landing/trust-strip";
import { FeatureSpotlight } from "@/components/landing/feature-spotlight";
import { RecentlyShipped } from "@/components/landing/recently-shipped";
import { AboutAuthor } from "@/components/landing/about-author";

export default function Home() {
  return (
    <main className="flex-1">
      <Hero />
      <TrustStrip />
      <FeatureSpotlight
        theme="compile"
        index={1}
        slides={[
          {
            label: "Diagnostics",
            title: "Compiled query preview — dry run",
            media: { light: "/diagnostics_light.png", dark: "/diagnostics_dark.png" },
            alt: "Inline diagnostics on a .sqlx file alongside the compiled query webview",
          },
        ]}
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

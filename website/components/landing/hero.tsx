import { ArrowRight, ArrowUpRight, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LiveDemo } from "@/components/landing/live-demo";
import { demoSources } from "@/lib/demo-source";
import { site } from "@/lib/site";

const editors = [
  { name: "VS Code", href: "https://code.visualstudio.com/" },
  { name: "Cursor", href: "https://cursor.com" },
  { name: "Antigravity", href: "https://antigravity.google/" },
];

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <div className="bg-grid absolute inset-0 -z-10" aria-hidden />
      <div className="glow-brand absolute inset-0 -z-10" aria-hidden />

      <div className="mx-auto max-w-6xl px-4 pb-5 pt-5 text-center sm:px-6 md:pt-7">
        <div className="reveal flex flex-wrap items-center justify-center gap-2.5">
          <a
            href="/changelog"
            className="group inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-3.5 py-1 text-xs font-medium text-brand shadow-sm backdrop-blur transition-all hover:bg-brand/20 hover:border-brand/60"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
            <span>v2.0.0: dbt projects on BigQuery, next to Dataform</span>
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </a>

          <a
            href={site.googleRecommendationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur transition-colors hover:border-brand/40 hover:text-foreground"
          >
            <span className="text-brand" aria-hidden>✦</span>
            Recommended by Google&apos;s Dataform team
            <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
          </a>
        </div>

        <h1
          className="reveal mx-auto mt-3 max-w-6xl text-balance text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl"
          style={{ "--reveal-delay": "80ms" } as React.CSSProperties}
        >
          See what your Dataform and dbt code will do —{" "}
          <span className="text-brand">before it runs.</span>
        </h1>

        <p
          className="reveal mx-auto mt-2.5 max-w-3xl text-balance text-sm text-muted-foreground sm:text-base"
          style={{ "--reveal-delay": "160ms" } as React.CSSProperties}
        >
          Compiled SQL, dry-run cost, schema, preview and runs for Dataform and dbt projects on BigQuery, in the
          editor you already use. Try it below.
        </p>

        <div
          className="reveal mt-4 flex flex-wrap justify-center gap-3"
          style={{ "--reveal-delay": "240ms" } as React.CSSProperties}
        >
          <Button asChild className="bg-brand px-5 text-brand-foreground hover:bg-brand/90">
            <a href={site.marketplace.vscode} target="_blank" rel="noopener noreferrer">
              Install for VS Code
            </a>
          </Button>
          <Button asChild variant="outline" className="px-5">
            <a href={site.repoUrl} target="_blank" rel="noopener noreferrer">
              <Github />
              View on GitHub
            </a>
          </Button>
        </div>

      </div>

      <div
        className="reveal mx-auto max-w-6xl px-4 sm:px-6"
        style={{ "--reveal-delay": "380ms" } as React.CSSProperties}
      >
        <LiveDemo sources={demoSources()} />
        <p
          className="mt-3 text-center text-xs text-muted-foreground"
        >
          Works in{" "}
          {editors.map((editor, i) => (
            <span key={editor.name}>
              <a href={editor.href} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:text-foreground hover:underline">
                {editor.name}
              </a>
              {i < editors.length - 1 ? ", " : ""}
            </span>
          ))}{" "}
          · Dataform 2.9.x and 3.x · dbt Core 1.8+ and dbt v2 · macOS, Linux, Windows
        </p>
      </div>
    </section>
  );
}

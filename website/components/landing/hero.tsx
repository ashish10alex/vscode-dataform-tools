import { ArrowRight, Github } from "lucide-react";
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

      {/* A small headline and the buttons share the row that sits on the frame: the demo is what the page opens on */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-x-6 gap-y-3 px-4 pb-3.5 pt-5 sm:px-6">
        <div className="reveal">
          <h1 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
            Dataform &amp; dbt on BigQuery with <span className="text-brand">one UI</span>
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Compiled SQL, dry-run cost, schema, preview and runs on BigQuery. This is the real panel: click around.
          </p>
        </div>
        <div className="reveal flex items-center gap-2" style={{ "--reveal-delay": "80ms" } as React.CSSProperties}>
          <Button asChild size="sm" variant="outline">
            <a href={site.repoUrl} target="_blank" rel="noopener noreferrer">
              <Github />
              GitHub
            </a>
          </Button>
          <Button asChild size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">
            <a href={site.marketplace.vscode} target="_blank" rel="noopener noreferrer">
              Install for VS Code
            </a>
          </Button>
        </div>
      </div>

      <div
        className="reveal mx-auto max-w-6xl px-4 sm:px-6"
        style={{ "--reveal-delay": "160ms" } as React.CSSProperties}
      >
        <LiveDemo sources={demoSources()} />
        <p
          className="mt-3 text-center text-xs text-muted-foreground"
        >
          <a href="/changelog" className="font-medium text-brand underline-offset-4 hover:underline">
            v2.0.0: dbt projects on BigQuery, next to Dataform <ArrowRight className="inline h-3 w-3" />
          </a>{" "}
          · Works in{" "}
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

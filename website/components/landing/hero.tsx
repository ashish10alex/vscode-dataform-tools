import { ArrowUpRight, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditorFrame } from "@/components/editor-frame";
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

      <div className="mx-auto max-w-6xl px-4 pb-10 pt-12 text-center sm:px-6 md:pt-16">
        <a
          href={site.googleRecommendationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="reveal group inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur transition-colors hover:border-brand/40 hover:text-foreground"
        >
          <span className="text-brand" aria-hidden>✦</span>
          Recommended by Google&apos;s Dataform team
          <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
        </a>

        <h1
          className="reveal mx-auto mt-5 max-w-5xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl md:text-wrap lg:text-[3.25rem]"
          style={{ "--reveal-delay": "80ms" } as React.CSSProperties}
        >
          See what your Dataform code will do —<br className="hidden md:block" />{" "}
          <span className="text-brand">before it runs.</span>
        </h1>

        <p
          className="reveal mx-auto mt-4 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg"
          style={{ "--reveal-delay": "160ms" } as React.CSSProperties}
        >
          Compiled SQL, dry-run cost, inline diagnostics, dependency graphs and schema-aware editing for
          Dataform projects, in the editor you already use.
        </p>

        <div
          className="reveal mt-6 flex flex-wrap justify-center gap-3"
          style={{ "--reveal-delay": "240ms" } as React.CSSProperties}
        >
          <Button asChild size="lg" className="bg-brand px-6 text-brand-foreground hover:bg-brand/90">
            <a href={site.marketplace.vscode} target="_blank" rel="noopener noreferrer">
              Install for VS Code
            </a>
          </Button>
          <Button asChild size="lg" variant="outline" className="px-6">
            <a href={site.repoUrl} target="_blank" rel="noopener noreferrer">
              <Github />
              View on GitHub
            </a>
          </Button>
        </div>

        <p
          className="reveal mt-4 text-xs text-muted-foreground"
          style={{ "--reveal-delay": "300ms" } as React.CSSProperties}
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
          · Dataform 2.9.x and 3.x · macOS, Linux, Windows
        </p>
      </div>

      <div
        className="reveal mx-auto max-w-6xl px-4 sm:px-6"
        style={{ "--reveal-delay": "380ms" } as React.CSSProperties}
      >
        <EditorFrame
          title="0200_PLAYER_TRANSFERS.sqlx — Compiled query preview"
          media={{ light: "/compiled_query_preview_light.png", dark: "/compiled_query_preview_dark.png" }}
          alt="A .sqlx file next to the compiled query preview, showing dry-run bytes and cost"
          priority
        />
      </div>
    </section>
  );
}

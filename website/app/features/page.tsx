import type { Metadata } from "next";
import { EditorFrame } from "@/components/editor-frame";
import { InlineCode } from "@/components/inline-code";
import { featuresByTheme, themes, type FeatureTheme } from "@/lib/features";

export const metadata: Metadata = {
  title: "Features",
  description: "Everything Dataform Tools adds to VS Code, Cursor and Antigravity.",
};

const themeOrder: FeatureTheme[] = ["compile", "graph", "editing", "run"];

export default function FeaturesPage() {
  return (
    <main className="flex-1">
      <div className="mx-auto max-w-6xl px-4 pt-16 sm:px-6">
        <p className="font-mono text-xs text-brand">-- features</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Everything in the box</h1>
        <nav className="mt-6 flex flex-wrap gap-2">
          {themeOrder.map((theme) => (
            <a
              key={theme}
              href={`#theme-${theme}`}
              className="rounded-full border px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground"
            >
              {themes[theme].label}
            </a>
          ))}
        </nav>
      </div>

      {themeOrder.map((theme, i) => (
        <section key={theme} id={`theme-${theme}`} className="mx-auto mt-20 max-w-6xl px-4 sm:px-6">
          <p className="font-mono text-xs text-brand">
            -- {String(i + 1).padStart(2, "0")} · {themes[theme].eyebrow}
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{themes[theme].label}</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">{themes[theme].blurb}</p>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {featuresByTheme(theme).map((feature) => (
              <article key={feature.id} id={feature.id} className="flex flex-col gap-4 rounded-xl border bg-card p-5">
                <div>
                  <h3 className="font-medium">
                    <a href={`#${feature.id}`} className="hover:text-brand">
                      {feature.title}
                    </a>
                  </h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    <InlineCode text={feature.summary} />
                  </p>
                  {feature.links && (
                    <p className="mt-2 flex flex-wrap gap-x-3 text-xs">
                      {feature.links.map((link) => (
                        <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                          {link.label} ↗
                        </a>
                      ))}
                    </p>
                  )}
                </div>
                {(feature.media || feature.mediaTodo) && (
                  <EditorFrame
                    title={feature.title}
                    media={feature.media}
                    mediaTodo={feature.mediaTodo}
                    alt={`${feature.title} in Dataform Tools`}
                    className="mt-auto"
                  />
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

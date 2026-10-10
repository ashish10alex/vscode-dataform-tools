import type { Metadata } from "next";
import { InlineCode } from "@/components/inline-code";
import { featuresByTheme, themes, type FeatureTheme } from "@/lib/features";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Features",
  description: `Everything ${site.name} adds to VS Code, Cursor and Antigravity.`,
};

const themeOrder: FeatureTheme[] = ["compile", "graph", "editing", "run"];

export default function FeaturesPage() {
  return (
    <main className="flex-1">
      <div className="mx-auto max-w-6xl px-4 pt-16 sm:px-6">
        <p className="font-mono text-xs text-brand">-- features</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Everything in the box</h1>
        <nav className="mt-6 flex flex-wrap gap-2" aria-label="Feature themes">
          {themeOrder.map((theme) => (
            <a
              key={theme}
              href={`#theme-${theme}`}
              className="rounded-full border px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground"
            >
              {themes[theme].label}
              <span className="ml-1.5 font-mono text-xs text-muted-foreground/70">{featuresByTheme(theme).length}</span>
            </a>
          ))}
        </nav>
      </div>

      {themeOrder.map((theme, i) => (
        <section
          key={theme}
          id={`theme-${theme}`}
          className="mx-auto mt-16 grid max-w-6xl scroll-mt-20 gap-x-12 gap-y-6 border-t px-4 pt-10 sm:px-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]"
        >
          {/* The theme stays in view beside its list on a wide screen */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-mono text-xs text-brand">
              -- {String(i + 1).padStart(2, "0")} · {themes[theme].eyebrow}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{themes[theme].label}</h2>
            <p className="mt-3 text-muted-foreground">{themes[theme].blurb}</p>
          </div>

          <ul className="divide-y">
            {featuresByTheme(theme).map((feature) => (
              <li key={feature.id} id={feature.id} className="scroll-mt-24 py-5 first:pt-0 last:pb-0">
                <h3 className="font-medium">
                  <a href={`#${feature.id}`} className="hover:text-brand">
                    {feature.title}
                  </a>
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  <InlineCode text={feature.summary} />
                </p>
                {feature.links && (
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {feature.links.map((link) => (
                      <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                        {link.label} ↗
                      </a>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="h-20" />
    </main>
  );
}

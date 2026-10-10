import type React from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { featuresByTheme, themes, type FeatureTheme } from "@/lib/features";

interface FeatureSpotlightProps {
  theme: FeatureTheme;
  index: number;
  /** A live frame as wide as the page, which the text sits above */
  demo: React.ReactNode;
  /** For the landing page, where the section is about a part of its theme */
  heading?: string;
  blurb?: string;
}

export function FeatureSpotlight({ theme, index, demo, heading, blurb: blurbOverride }: FeatureSpotlightProps) {
  const { label, eyebrow } = themes[theme];
  const blurb = blurbOverride ?? themes[theme].blurb;
  const items = featuresByTheme(theme);

  return (
    <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6 md:mt-24">
      <div className="grid items-end gap-x-12 gap-y-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <p className="font-mono text-xs text-brand">
            -- {String(index).padStart(2, "0")} · {eyebrow}
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{heading ?? label}</h2>
          <p className="mt-3 text-muted-foreground">{blurb}</p>
        </div>
        <div>
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.id}>
                <Link href={`/features#${item.id}`} title={item.summary} className="group flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                  <span className="group-hover:text-brand">{item.title}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href={`/features#theme-${theme}`} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium hover:text-brand">
            See all features <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
      <div className="mt-8">{demo}</div>
    </section>
  );
}

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { EditorFrame } from "@/components/editor-frame";
import { cn } from "@/lib/utils";
import { MediaSwitcher, type MediaSlide } from "@/components/media-switcher";
import { featuresByTheme, themes, type FeatureTheme } from "@/lib/features";

interface FeatureSpotlightProps {
  theme: FeatureTheme;
  index: number;
  /** One slide renders a plain frame; several render a switcher that defaults to the first. */
  slides: MediaSlide[];
  reverse?: boolean;
}

export function FeatureSpotlight({ theme, index, slides, reverse }: FeatureSpotlightProps) {
  const { label, eyebrow, blurb } = themes[theme];
  const items = featuresByTheme(theme);

  return (
    <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6 md:mt-24">
      <div className={cn("grid items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12", reverse && "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]")}>
        <div className={cn(reverse && "lg:order-2")}>
          <p className="font-mono text-xs text-brand">
            -- {String(index).padStart(2, "0")} · {eyebrow}
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{label}</h2>
          <p className="mt-3 text-muted-foreground">{blurb}</p>

          <ul className="mt-6 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.id}>
                <Link href={`/features#${item.id}`} title={item.summary} className="group flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                  <span className="group-hover:text-brand">{item.title}</span>
                </Link>
              </li>
            ))}
          </ul>

          <Link href={`/features#theme-${theme}`} className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium hover:text-brand">
            See all features <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className={cn(reverse && "lg:order-1")}>
          {slides.length > 1 ? (
            <MediaSwitcher slides={slides} />
          ) : (
            <EditorFrame title={slides[0].title} media={slides[0].media} alt={slides[0].alt} />
          )}
        </div>
      </div>
    </section>
  );
}

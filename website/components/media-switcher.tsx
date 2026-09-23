"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EditorFrame } from "@/components/editor-frame";
import { cn } from "@/lib/utils";
import type { FeatureMedia } from "@/lib/features";

export interface MediaSlide {
  label: string;
  title: string;
  media: FeatureMedia;
  alt: string;
}

/** An EditorFrame that flips between a few screenshots; the first slide shows by default. */
export function MediaSwitcher({ slides }: { slides: MediaSlide[] }) {
  const [index, setIndex] = useState(0);
  const slide = slides[index];
  const go = (delta: number) => setIndex((i) => (i + delta + slides.length) % slides.length);

  const arrowClass =
    "absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border bg-background/80 text-foreground shadow-sm backdrop-blur transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="Screenshots"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
      className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <EditorFrame title={slide.title} media={slide.media} alt={slide.alt} aspectClass="aspect-[3/2]">
        <button type="button" onClick={() => go(-1)} className={cn(arrowClass, "left-3")} aria-label="Previous screenshot">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => go(1)} className={cn(arrowClass, "right-3")} aria-label="Next screenshot">
          <ChevronRight className="h-4 w-4" />
        </button>
      </EditorFrame>

      <div className="mt-3 flex justify-center gap-1.5" role="tablist">
        {slides.map((s, i) => (
          <button
            key={s.label}
            type="button"
            role="tab"
            aria-selected={i === index}
            onClick={() => setIndex(i)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              i === index ? "border-brand/50 bg-brand/10 text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

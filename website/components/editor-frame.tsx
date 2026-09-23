import type React from "react";
import { Clapperboard } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FeatureMedia } from "@/lib/features";

interface EditorFrameProps {
  title: string;
  media?: FeatureMedia;
  /** Shown in place of media that hasn't been recorded yet. */
  mediaTodo?: string;
  alt: string;
  priority?: boolean;
  className?: string;
  /** Fixes the media box to an aspect ratio (e.g. "aspect-[3/2]") so switching screenshots doesn't shift layout. */
  aspectClass?: string;
  /** Rendered over the media, e.g. carousel controls. */
  children?: React.ReactNode;
}

/**
 * Window chrome around a screenshot, loop or placeholder. Light and dark
 * screenshots are both rendered and toggled with CSS so the right one shows
 * on first paint, without waiting for the theme to hydrate.
 */
export function EditorFrame({ title, media, mediaTodo, alt, priority, className, aspectClass, children }: EditorFrameProps) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-xl border bg-card shadow-[0_1px_0_0_hsl(var(--border)),0_24px_48px_-24px_rgb(0_0_0/0.35)]",
        className
      )}
    >
      <div className="flex h-9 items-center gap-2 border-b bg-muted/40 px-3.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
        </span>
        <figcaption className="truncate font-mono text-[11px] text-muted-foreground">{title}</figcaption>
      </div>
      <div className={cn("relative", aspectClass)}>
        <FrameBody media={media} mediaTodo={mediaTodo} alt={alt} priority={priority} fill={Boolean(aspectClass)} />
        {children}
      </div>
    </figure>
  );
}

function FrameBody({
  media,
  mediaTodo,
  alt,
  priority,
  fill,
}: Pick<EditorFrameProps, "media" | "mediaTodo" | "alt" | "priority"> & { fill: boolean }) {
  const loading = priority ? "eager" : "lazy";
  const size = fill ? "h-full w-full object-contain" : "w-full";

  if (media?.video) {
    return (
      <video
        src={media.video}
        poster={media.light ?? media.dark}
        autoPlay
        muted
        loop
        playsInline
        aria-label={alt}
        className={cn("block", size)}
      />
    );
  }

  if (media?.light || media?.dark) {
    const light = media.light ?? media.dark!;
    const dark = media.dark ?? media.light!;
    if (light === dark) {
      return <img src={light} alt={alt} loading={loading} className={cn("block", size)} />;
    }
    return (
      <>
        <img src={light} alt={alt} loading={loading} className={cn("block dark:hidden", size)} />
        <img src={dark} alt={alt} loading={loading} className={cn("hidden dark:block", size)} />
      </>
    );
  }

  return (
    <div className={cn("flex flex-col", fill ? "h-full" : "aspect-[16/9]", " items-center justify-center gap-2 bg-[repeating-linear-gradient(135deg,transparent,transparent_10px,hsl(var(--muted)/0.6)_10px,hsl(var(--muted)/0.6)_11px)] p-6 text-center")}>
      <Clapperboard className="h-5 w-5 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium text-muted-foreground">Recording coming soon</p>
      {mediaTodo && <p className="max-w-xs font-mono text-[11px] text-muted-foreground/70">{mediaTodo}</p>}
    </div>
  );
}

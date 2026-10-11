"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { MousePointerClick } from "lucide-react";
import { cn } from "@/lib/utils";
import { site } from "@/lib/site";
import { NOTES, NOTE_AS_IS } from "@/components/landing/live-demo";

/*
 * The dependency inspector, live: the extension's own bundle in an iframe, answered by a stand-in for the extension
 * host (public/demo/inspector-host.js) with what the real host answered for the demo Project. It opens on the graph
 * of the hero's model and what it reads from, with a filter in place; Run All fills in the rows of each table.
 */

type DemoMessage =
  | { source: "vdt-demo"; backend?: string; type: "rendered" | "height"; height: number }
  | { source: "vdt-demo"; backend?: string; type: "note"; command: string };

// What the inspector needs to show its graph whole, at the width the frame has on a wide screen. What a run lists
// under the graph is reached by scrolling in the frame, so that the page does not jump when Run All is clicked.
const FRAME_HEIGHT = 824;

type DemoWindow = Window & { demoSetTheme?: (theme: string) => void; demoPulse?: () => void };

export function InspectorDemo() {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" ? "light" : "dark";
  const [mounted, setMounted] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [note, setNote] = useState<{ text: string; install: boolean; id: number } | null>(null);
  const frame = useRef<HTMLElement>(null);
  const inspector = useRef<HTMLIFrameElement>(null);
  const openedWith = useRef(theme);

  // The inspector is loaded when the frame is near the window, and Run All is ringed once it is in view
  useEffect(() => {
    openedWith.current = theme;
    const near = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setMounted(true);
          near.disconnect();
        }
      },
      { rootMargin: "400px" }
    );
    near.observe(frame.current!);
    return () => near.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!rendered) {
      return;
    }
    const inView = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          (inspector.current?.contentWindow as DemoWindow | null | undefined)?.demoPulse?.();
          inView.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    inView.observe(frame.current!);
    return () => inView.disconnect();
  }, [rendered]);

  useEffect(() => {
    (inspector.current?.contentWindow as DemoWindow | null | undefined)?.demoSetTheme?.(theme);
  }, [theme, rendered]);

  useEffect(() => {
    if (!note) {
      return;
    }
    const timer = setTimeout(() => setNote(null), 4500);
    return () => clearTimeout(timer);
  }, [note]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as DemoMessage | undefined;
      if (event.origin !== window.location.origin || message?.source !== "vdt-demo" || message.backend !== "inspector") {
        return;
      }
      if (message.type === "rendered") {
        setHeight(message.height);
        setRendered(true);
      } else if (message.type === "note") {
        setNote(
          NOTE_AS_IS[message.command]
            ? { text: NOTE_AS_IS[message.command], install: false, id: Date.now() }
            : { text: `${NOTES[message.command] ?? "This works"} in the editor.`, install: true, id: Date.now() }
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <figure ref={frame} className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_0_0_hsl(var(--border)),0_24px_48px_-24px_rgb(0_0_0/0.35)]">
      <div className="flex h-9 items-stretch border-b bg-muted/40">
        <span className="flex items-center gap-1.5 px-3.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
        </span>
        <span className="flex items-center gap-1.5 border-x bg-white px-3 font-mono text-[11px] text-foreground dark:bg-[#1e1e1e]">
          Dependency Inspector
          <span className="rounded bg-foreground/10 px-1 py-px font-sans text-[10px] text-muted-foreground">Dataform</span>
        </span>
        <figcaption className="ml-auto hidden items-center gap-1.5 px-3.5 text-[11px] text-muted-foreground sm:flex">
          <MousePointerClick className="h-3.5 w-3.5 text-brand" aria-hidden />
          Live demo · press Run All
        </figcaption>
      </div>

      <div className="relative bg-white dark:bg-[#1e1e1e]" style={{ height: height ?? FRAME_HEIGHT }}>
        {(["light", "dark"] as const).map((shade) => (
          <img
            key={shade}
            src={`/demo/poster-inspector-${shade}.png`}
            alt={shade === "dark" ? "The dependency inspector: a model and the tables it reads from as a graph, with one filter to run on all of them" : ""}
            aria-hidden={shade === "light" || rendered}
            loading="lazy"
            className={cn(
              "absolute inset-0 h-full w-full object-cover object-left-top transition-opacity duration-300",
              shade === "dark" ? "hidden dark:block" : "block dark:hidden",
              rendered && "opacity-0"
            )}
          />
        ))}
        {mounted && (
          <iframe
            ref={inspector}
            src={`/demo/inspector.html?theme=${openedWith.current}`}
            title="Live demo of the dependency inspector, on the tables of the demo project"
            allow="clipboard-write"
            className={cn("absolute inset-0 h-full w-full border-0 transition-opacity duration-300", rendered ? "opacity-100" : "opacity-0")}
          />
        )}

        {note && (
          <div key={note.id} role="status" className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
            <div className="pointer-events-auto flex items-center gap-3 rounded-lg border bg-popover px-3.5 py-2 text-left text-xs text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
              <span>{note.text}</span>
              {note.install && (
                <a href={site.marketplace.vscode} target="_blank" rel="noopener noreferrer" className="shrink-0 font-medium text-brand underline-offset-4 hover:underline">
                  Install
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}

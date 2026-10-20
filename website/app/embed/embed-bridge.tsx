"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

/**
 * Talks to the page that frames /embed. Out: `{ type: "dataform-tools-embed:height", height }` whenever
 * the demo changes size, so the parent can fit the iframe to it. In: `{ type: "dataform-tools-embed:theme",
 * theme: "light" | "dark" }`, so the demo follows the parent's theme toggle. `?theme=` sets the first one.
 */
export function EmbedBridge() {
  const { setTheme } = useTheme();

  useEffect(() => {
    if (window.parent === window) return;

    const initial = new URLSearchParams(location.search).get("theme");
    if (initial === "light" || initial === "dark") setTheme(initial);

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === "dataform-tools-embed:theme" && (data.theme === "light" || data.theme === "dark")) {
        setTheme(data.theme);
      }
    };
    window.addEventListener("message", onMessage);

    const report = () =>
      window.parent.postMessage(
        { type: "dataform-tools-embed:height", height: document.documentElement.scrollHeight },
        "*",
      );
    const observer = new ResizeObserver(report);
    observer.observe(document.body);
    report();

    return () => {
      window.removeEventListener("message", onMessage);
      observer.disconnect();
    };
  }, [setTheme]);

  return null;
}

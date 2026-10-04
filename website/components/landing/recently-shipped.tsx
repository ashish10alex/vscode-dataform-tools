import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { getRecentFeatures } from "@/lib/changelog";
import { formatReleaseDate } from "@/lib/utils";
import { InlineCode } from "@/components/inline-code";

export function RecentlyShipped() {
  const recent = getRecentFeatures(6);

  return (
    <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6 md:mt-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-brand">-- recently shipped</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Fresh off the release branch</h2>
        </div>
        <Link href="/changelog" className="inline-flex items-center gap-1.5 text-sm font-medium hover:text-brand">
          Full changelog <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <ul className="mt-8 grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {recent.map((feature) => {
          const descriptionText = feature.title && feature.text.startsWith(feature.title)
            ? feature.text.slice(feature.title.length + 2).trim()
            : feature.text;

          const body = (
            <>
              <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                <span className="rounded border px-1.5 py-0.5 text-foreground font-medium">v{feature.version}</span>
                <time dateTime={feature.date}>{formatReleaseDate(feature.date)}</time>
              </div>
              <div className="space-y-1">
                {feature.title && (
                  <h3 className="text-sm font-semibold tracking-tight text-foreground">
                    {feature.title}
                  </h3>
                )}
                <p className="text-sm leading-relaxed text-muted-foreground">
                  <InlineCode text={descriptionText} />
                </p>
              </div>
            </>
          );
          const cardClass = "flex h-full flex-col gap-3 p-5";

          return (
            <li key={`${feature.version}-${feature.text}`} className="bg-card">
              {feature.href ? (
                <a
                  href={feature.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`group ${cardClass} transition-colors hover:bg-muted/40`}
                >
                  {body}
                  <span className="mt-auto inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-brand">
                    {feature.href.includes("/commit/") ? "View commit" : "View pull request"}
                    <ArrowUpRight className="h-3 w-3" />
                  </span>
                </a>
              ) : (
                <div className={cardClass}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

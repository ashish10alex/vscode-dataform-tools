import type { Metadata } from "next";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { getReleases } from "@/lib/changelog";
import { formatReleaseDate } from "@/lib/utils";
import { InlineCode } from "@/components/inline-code";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Changelog",
  description: "New features in every Dataform Tools release.",
};

export default function ChangelogPage() {
  const releases = getReleases();

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-3xl px-4 pt-16 sm:px-6">
        <p className="font-mono text-xs text-brand">-- changelog</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">What&apos;s new</h1>
        <p className="mt-4 text-muted-foreground">
          New features in each release, generated from{" "}
          <a href={site.changelogSourceUrl} target="_blank" rel="noopener noreferrer" className="text-foreground underline-offset-4 hover:underline">
            CHANGELOG.md
          </a>
          . Releases with only bug fixes are left out.
        </p>

        <ol className="mt-12 border-l">
          {releases.map((release, releaseIdx) => {
            const isLatest = releaseIdx === 0;

            return (
              <li
                key={release.version}
                id={`v${release.version}`}
                className={`relative pb-10 pl-6 last:pb-0 ${isLatest ? "pt-1" : ""}`}
              >
                <span
                  className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background ${
                    isLatest ? "bg-brand ring-4 ring-brand/20" : "bg-muted-foreground/40"
                  }`}
                  aria-hidden
                />
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <a
                    href={release.compareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-center gap-1 font-mono text-base font-semibold hover:text-brand"
                  >
                    v{release.version}
                    <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                  </a>

                  {isLatest && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
                      <Sparkles className="h-3 w-3" /> Latest Milestone
                    </span>
                  )}

                  <time dateTime={release.date} className="text-xs text-muted-foreground">
                    {formatReleaseDate(release.date)}
                  </time>
                </div>

                <ul className="mt-4 space-y-3">
                  {release.features.map((feature, i) => (
                    <li key={i} className="text-sm leading-relaxed">
                      <div className="flex items-start">
                        {feature.scope && (
                          <span className="mr-2 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                            {feature.scope}
                          </span>
                        )}
                        <div>
                          {feature.href ? (
                            <a
                              href={feature.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              <InlineCode text={feature.title ? `${feature.title}:` : feature.text} />
                            </a>
                          ) : (
                            <span className="font-medium">
                              <InlineCode text={feature.title ? `${feature.title}:` : feature.text} />
                            </span>
                          )}

                          {feature.details && feature.details.length > 0 ? (
                            <ul className="mt-2 space-y-1 pl-4 text-muted-foreground">
                              {feature.details.map((detail, dIdx) => (
                                <li key={dIdx} className="list-disc text-xs leading-normal">
                                  <InlineCode text={detail} />
                                </li>
                              ))}
                            </ul>
                          ) : feature.title ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              <InlineCode text={feature.text.slice(feature.title.length + 2)} />
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </div>
    </main>
  );
}

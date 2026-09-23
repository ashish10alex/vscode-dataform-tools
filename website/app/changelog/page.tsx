import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
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
          {releases.map((release) => (
            <li key={release.version} id={`v${release.version}`} className="relative pb-10 pl-6 last:pb-0">
              <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-brand" aria-hidden />
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <a href={release.compareUrl} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-1 font-mono text-sm font-medium hover:text-brand">
                  v{release.version}
                  <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                </a>
                <time dateTime={release.date} className="text-xs text-muted-foreground">
                  {formatReleaseDate(release.date)}
                </time>
              </div>
              <ul className="mt-3 space-y-2">
                {release.features.map((feature, i) => (
                  <li key={i} className="text-sm leading-relaxed">
                    {feature.scope && (
                      <span className="mr-2 rounded border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{feature.scope}</span>
                    )}
                    {feature.href ? (
                      <a href={feature.href} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
                        <InlineCode text={feature.text} />
                      </a>
                    ) : (
                      <InlineCode text={feature.text} />
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}

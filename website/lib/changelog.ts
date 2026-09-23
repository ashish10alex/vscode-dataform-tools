import fs from "node:fs";
import path from "node:path";

export interface ChangelogFeature {
  scope?: string;
  text: string;
  href?: string;
}

export interface Release {
  version: string;
  date: string;
  compareUrl: string;
  features: ChangelogFeature[];
}

// The website is deployed from `website/`, the changelog lives at the repo root
// and is maintained by standard-version on every release.
const CHANGELOG_PATH = path.join(process.cwd(), "..", "CHANGELOG.md");

const RELEASE_HEADING = /^#{2,3} \[(\d+\.\d+\.\d+)\]\(([^)]+)\) \((\d{4}-\d{2}-\d{2})\)\s*$/gm;
const MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

export function parseChangelog(markdown: string): Release[] {
  const headings = [...markdown.matchAll(RELEASE_HEADING)];

  const releases = new Map<string, Release>();
  headings.forEach((heading, i) => {
    const bodyStart = heading.index! + heading[0].length;
    const bodyEnd = headings[i + 1]?.index ?? markdown.length;
    const features = parseFeatureBlock(markdown.slice(bodyStart, bodyEnd));

    // A few versions were released twice and appear as two sections; merge them.
    const existing = releases.get(heading[1]);
    if (existing) {
      existing.features.push(...features);
      return;
    }
    releases.set(heading[1], {
      version: heading[1],
      compareUrl: heading[2],
      date: heading[3],
      features,
    });
  });
  return [...releases.values()];
}

function parseFeatureBlock(releaseBody: string): ChangelogFeature[] {
  const block = releaseBody.match(/^### Features\s*$([\s\S]*?)(?=^### |(?![\s\S]))/m);
  if (!block) {
    return [];
  }
  return block[1]
    .split("\n")
    .filter((line) => line.startsWith("* "))
    .map(parseBullet);
}

function parseBullet(line: string): ChangelogFeature {
  let text = line.slice(2);

  const links = [...text.matchAll(MD_LINK)].map((m) => m[2]);
  const href =
    links.find((url) => /\/(issues|pull)\/\d+/.test(url)) ??
    links.find((url) => url.includes("/commit/"));

  // Drop standard-version's trailing references: "([#123](…)) ([abc1234](…)), closes [#99](…)"
  text = text
    .replace(/,?\s*closes\s+.*$/i, "")
    .replace(/\s*\(\[[^\]]+\]\([^)]+\)\)/g, "")
    .trim();

  const scopeMatch = text.match(/^\*\*([^*]+):\*\*\s*/);
  const scope = scopeMatch?.[1].trim();
  if (scopeMatch) {
    text = text.slice(scopeMatch[0].length);
  }
  // Commit subjects sometimes repeat the PR number, e.g. "… (#332)".
  text = text.replace(/\s*\(#\d+\)(\s*\(#\d+\))*$/, "");

  return {
    scope,
    text: text.charAt(0).toUpperCase() + text.slice(1),
    href,
  };
}

let cached: Release[] | undefined;

function loadReleases(): Release[] {
  if (!cached) {
    if (!fs.existsSync(CHANGELOG_PATH)) {
      throw new Error(
        `CHANGELOG.md not found at ${CHANGELOG_PATH}. The website build needs the repository root to be available.`
      );
    }
    cached = parseChangelog(fs.readFileSync(CHANGELOG_PATH, "utf8"));
  }
  return cached;
}

/** Every release, and the date of the oldest one — for "N releases since …" copy. */
export function getReleaseStats() {
  const releases = loadReleases();
  return { count: releases.length, since: releases[releases.length - 1]?.date };
}

/** Releases that shipped at least one feature, newest first. */
export function getReleases(): Release[] {
  return loadReleases().filter((release) => release.features.length > 0);
}

export function getRecentFeatures(count: number) {
  return getReleases()
    .flatMap((release) =>
      release.features.map((feature) => ({
        ...feature,
        version: release.version,
        date: release.date,
      }))
    )
    .slice(0, count);
}

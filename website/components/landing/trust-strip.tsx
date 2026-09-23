import { site } from "@/lib/site";
import { getReleaseStats } from "@/lib/changelog";

const badges = [
  {
    href: site.marketplace.vscode,
    title: "VS Code Marketplace",
    // shields.io retired its VS Code Marketplace badges, so this one is static.
    images: [{ src: "https://img.shields.io/badge/VS%20Code-Marketplace-2563eb?style=flat-square", alt: "VS Code Marketplace" }],
  },
  {
    href: site.marketplace.openVsx,
    title: "Open VSX",
    images: [
      { src: "https://img.shields.io/open-vsx/v/ashishalex/dataform-lsp-vscode?style=flat-square&color=2563eb&label=Open%20VSX", alt: "Open VSX version" },
      { src: "https://img.shields.io/open-vsx/dt/ashishalex/dataform-lsp-vscode?style=flat-square&color=2563eb&label=downloads", alt: "Open VSX downloads" },
    ],
  },
  {
    href: site.marketplace.npm,
    title: "npm wrapper",
    images: [{ src: "https://img.shields.io/npm/v/%40ashishalex%2Fdataform-tools?style=flat-square&color=2563eb&label=npm", alt: "npm version" }],
  },
  {
    href: site.marketplace.pypi,
    title: "PyPI wrapper",
    images: [{ src: "https://img.shields.io/pypi/v/dataform-tools?style=flat-square&color=2563eb&label=PyPI", alt: "PyPI version" }],
  },
];

export function TrustStrip() {
  const { count, since } = getReleaseStats();
  const sinceLabel = since
    ? new Date(since).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    : undefined;

  return (
    <section className="mx-auto mt-10 max-w-6xl px-4 sm:px-6">
      <div className="flex flex-col items-center gap-4 border-y py-4 md:flex-row md:justify-between">
        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Open source · {count} releases{sinceLabel ? ` since ${sinceLabel}` : ""}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {badges.map((badge) => (
            <a
              key={badge.href}
              href={badge.href}
              target="_blank"
              rel="noopener noreferrer"
              title={badge.title}
              className="flex items-center gap-1 rounded-md p-1 opacity-80 transition hover:bg-muted hover:opacity-100"
            >
              {badge.images.map((image) => (
                <img key={image.src} src={image.src} alt={image.alt} className="h-5" loading="lazy" />
              ))}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

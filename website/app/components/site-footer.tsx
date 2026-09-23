import { Github, Linkedin } from "lucide-react";
import Link from "next/link";
import { site } from "@/lib/site";

const linkClass = "text-muted-foreground transition-colors hover:text-foreground";

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:px-6 md:grid-cols-[1fr_auto_auto] md:gap-16">
        <div className="space-y-3">
          <p>
            Made by{" "}
            <a href={site.author.github} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
              {site.author.name}
            </a>
          </p>
          <div className="flex items-center gap-3">
            <a href={site.author.github} target="_blank" rel="noopener noreferrer" className={linkClass}>
              <Github className="h-4 w-4" />
              <span className="sr-only">{site.author.name} on GitHub</span>
            </a>
            <a href={site.author.linkedin} target="_blank" rel="noopener noreferrer" className={linkClass}>
              <Linkedin className="h-4 w-4" />
              <span className="sr-only">{site.author.name} on LinkedIn</span>
            </a>
          </div>
          <p className="max-w-sm text-xs text-muted-foreground">
            Community-built and open source · not an official Google product.
          </p>
        </div>

        <nav className="flex flex-col gap-2">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground/70">Project</span>
          <Link href="/features" className={linkClass}>Features</Link>
          <Link href="/changelog" className={linkClass}>Changelog</Link>
          <a href={site.repoUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>GitHub</a>
        </nav>

        <nav className="flex flex-col gap-2">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground/70">Get it</span>
          <a href={site.marketplace.vscode} target="_blank" rel="noopener noreferrer" className={linkClass}>VS Code Marketplace</a>
          <a href={site.marketplace.openVsx} target="_blank" rel="noopener noreferrer" className={linkClass}>Open VSX</a>
          <a href={site.marketplace.npm} target="_blank" rel="noopener noreferrer" className={linkClass}>npm</a>
          <a href={site.marketplace.pypi} target="_blank" rel="noopener noreferrer" className={linkClass}>PyPI</a>
        </nav>
      </div>
    </footer>
  );
}

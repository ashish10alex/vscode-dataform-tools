import { Github } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import FeatureReels from "@/components/feature-reels";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold">Dataform Tools</span>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
              VSCode Extension
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" asChild>
              <Link
                href="https://marketplace.visualstudio.com/items?itemName=ashish10alex.dataform-tools"
                target="_blank"
                rel="noopener noreferrer"
              >
                Install Extension
              </Link>
            </Button>
            <Button variant="ghost" size="icon" asChild>
              <Link
                href="https://github.com/ashish10alex/vscode-dataform-tools"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Github className="h-5 w-5" />
                <span className="sr-only">GitHub</span>
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="container py-12 md:py-16 lg:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              Supercharge Your Dataform Workflow
            </h1>
            <p className="mt-4 text-lg text-muted-foreground md:text-xl">
              Dataform Tools enhances your development experience with powerful features for SQL compilation, schema
              exploration, and more.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Button asChild>
                <Link
                  href="https://marketplace.visualstudio.com/items?itemName=ashish10alex.dataform-tools"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Get Started
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link
                  href="https://github.com/ashish10alex/vscode-dataform-tools"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Github className="mr-2 h-4 w-4" />
                  View on GitHub
                </Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="container py-8 md:py-12">
          <h2 className="mb-8 text-center text-2xl font-bold tracking-tight md:text-3xl">Feature Showcase</h2>
          <FeatureReels />
        </section>
      </main>

      <footer className="border-t py-6 md:py-8">
        <div className="container flex flex-col items-center justify-between gap-4 md:flex-row">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Dataform Tools. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <Link
              href="https://github.com/ashish10alex/vscode-dataform-tools"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              GitHub
            </Link>
            <Link
              href="https://marketplace.visualstudio.com/items?itemName=ashish10alex.dataform-tools"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              VSCode Marketplace
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

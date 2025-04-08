import { Github } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import FeatureReels from "@/components/feature-reels";

export default function Home() {
  return (
    <main className="flex-1">
      <section className="container py-3 md:py-4 lg:py-5">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl md:text-3xl">
            Supercharge Your Dataform Workflow
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
            Dataform Tools enhances your development experience with powerful features for SQL compilation, schema
            exploration, and more.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link
                href="https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode"
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

      <section className="container py-6 md:py-8">
        <div className="mx-auto max-w-6xl rounded-lg border bg-card p-2 shadow-sm">
          <div className="overflow-hidden rounded-md">
            <img
              src="compiled_query_preview.png"
              alt="Dataform Tools VSCode Extension Preview"
              className="w-full object-cover"
              width={1200}
              height={675}
            />
          </div>
        </div>
      </section>

    </main>
  );
}

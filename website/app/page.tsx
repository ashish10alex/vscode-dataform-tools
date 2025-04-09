import { Github } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ThemeImage } from "@/components/theme-image";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center">
      <section className="w-full flex justify-center py-3 md:py-4 lg:py-5">
        <div className="mx-auto max-w-4xl text-center px-4">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl md:text-3xl">
          Dataform Tools VSCode Extension
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
            A powerful VS Code extension for Dataform (v2.x & v3.x) with features like compiled query previews, dependency graphs, 
            inline diagnostics, schema generation, cost estimation, and more.
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

      <section className="container-fluid py-4 md:py-6">
        <div className="mx-auto max-w-[90%] rounded-lg border bg-card p-3 md:p-5 shadow-sm">
          <div className="flex justify-center items-center overflow-hidden rounded-md">
            <ThemeImage 
              lightSrc="compiled_query_preview_light_mode.png"
              darkSrc="compiled_query_preview_dark_mode.png"
              alt="Dataform Tools VSCode Extension Preview"
              className="w-full max-w-[1200px] h-auto object-contain"
              width={1200}
              height={675}
            />
          </div>
          <div className="flex justify-center mt-4 mb-2">
            <Button
              asChild
              variant="default"
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200"
            >
              <Link href="/features">
                Explore Features →
              </Link>
            </Button>
          </div>
        </div>
      </section>

    </main>
  );
}

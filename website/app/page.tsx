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
          Dataform Tools VS Code Extension
          </h1>
          <div className="mt-3 text-sm text-muted-foreground md:text-base text-center">
            <p className="mb-1">
              <a 
                href="https://github.com/dataform-co/dataform/blob/main/vscode/README.md" 
                className="font-semibold text-foreground hover:underline" 
                target="_blank" 
                rel="noopener noreferrer"
              >
                Officially recommended VS Code extension for Dataform by Google
              </a> ✨
            </p>
            <p>
              Supports all major operating systems and both Dataform versions 2.9.x and 3.x.<br className="hidden sm:inline" /> Works in: <a href="https://code.visualstudio.com/" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">VS Code</a>, <a href="https://cursor.com" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">Cursor</a>, <a href="https://antigravity.google/" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">Antigravity</a>.
            </p>
          </div>
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
          
          <div className="mt-8 flex flex-col items-center">
            <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wider">Available On</p>
            <div className="flex flex-wrap justify-center gap-4 text-sm opacity-80 hover:opacity-100 transition-opacity">
              <a href="https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:bg-muted p-1.5 rounded-md transition-colors" title="VS Code marketplace">
                <img src="https://img.shields.io/visual-studio-marketplace/v/ashishalex.dataform-lsp-vscode?style=flat-square&color=blue" alt="VS Code marketplace" className="h-5" />
                <img src="https://img.shields.io/vscode-marketplace/i/ashishalex.dataform-lsp-vscode.svg?style=flat-square&color=blue" alt="Downloads" className="h-5 hidden sm:block" />
              </a>
              <a href="https://open-vsx.org/extension/ashishalex/dataform-lsp-vscode" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:bg-muted p-1.5 rounded-md transition-colors" title="Open VSX marketplace">
                <img src="https://img.shields.io/open-vsx/v/ashishalex/dataform-lsp-vscode?style=flat-square&color=blue" alt="Open VSX Version" className="h-5" />
              </a>
              <a href="https://pypi.org/project/dataform-tools/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:bg-muted p-1.5 rounded-md transition-colors" title="PyPi wrapper">
                <img src="https://img.shields.io/pypi/v/dataform-tools?style=flat-square&color=blue" alt="PyPI - Version" className="h-5" />
              </a>
              <a href="https://www.npmjs.com/package/@ashishalex/dataform-tools" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:bg-muted p-1.5 rounded-md transition-colors" title="npm wrapper">
                <img src="https://img.shields.io/npm/v/%40ashishalex%2Fdataform-tools?style=flat-square&color=blue" alt="NPM Version" className="h-5" />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="container-fluid py-4 md:py-6">
        <div className="mx-auto max-w-[90%] rounded-lg border bg-card p-3 md:p-5 shadow-sm">
          <div className="flex justify-center items-center overflow-hidden rounded-md">
            <ThemeImage 
              lightSrc="/compiled_query_preview_light.png"
              darkSrc="/compiled_query_preview_dark.png"
              alt="Dataform Tools VS Code Extension Preview"
              className="w-full max-w-[1400px] h-auto object-contain"
              width={1400}
              height={788}
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

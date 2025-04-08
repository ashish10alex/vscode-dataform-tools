import { Github } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Link href="/" className="text-xl font-bold">
              Dataform Tools
            </Link>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
              VSCode Extension
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <Link
              href="/"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Home
            </Link>
            <Link
              href="/features"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Features
            </Link>
            <Link
              href="/faq"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              FAQ
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" asChild>
            <Link
              href="https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode"
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
  );
} 
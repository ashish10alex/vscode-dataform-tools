import { Github } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center px-8">
        <div className="flex flex-1 items-center justify-center space-x-2 md:justify-start md:pl-4">
          <nav className="hidden md:flex items-center space-x-8">
            <Link
              href="/"
              className="text-sm font-medium transition-colors hover:text-primary"
            >
              Home
            </Link>
            <Link
              href="/install"
              className="text-sm font-medium transition-colors hover:text-primary"
            >
              Install
            </Link>
            <Link
              href="/features"
              className="text-sm font-medium transition-colors hover:text-primary"
            >
              Features
            </Link>
            <Link
              href="/faq"
              className="text-sm font-medium transition-colors hover:text-primary"
            >
              FAQ
            </Link>
          </nav>
        </div>
        <div className="flex items-center justify-end space-x-4">
          <Button variant="outline" size="sm" className="h-8 px-4 transition-colors" asChild>
            <Link
              href="https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode"
              target="_blank"
              rel="noopener noreferrer"
            >
              Install Extension
            </Link>
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 transition-colors" asChild>
            <Link
              href="https://github.com/ashish10alex/vscode-dataform-tools"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary"
            >
              <Github className="h-4 w-4" />
              <span className="sr-only">GitHub</span>
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
} 
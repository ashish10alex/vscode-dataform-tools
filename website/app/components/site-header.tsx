"use client";

import { Github } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center px-8">
        <div className="flex flex-1 items-center justify-center space-x-2 md:justify-start md:pl-4">
          <nav className="hidden md:flex items-center space-x-8">
            <Link
              href="/"
              className={cn(
                "text-sm font-medium transition-colors hover:text-primary",
                pathname === "/" && "text-primary font-bold"
              )}
            >
              Home
            </Link>
            <Link
              href="/install"
              className={cn(
                "text-sm font-medium transition-colors hover:text-primary",
                pathname === "/install" && "text-primary font-bold"
              )}
            >
              Install
            </Link>
            <Link
              href="/features"
              className={cn(
                "text-sm font-medium transition-colors hover:text-primary",
                pathname === "/features" && "text-primary font-bold"
              )}
            >
              Features
            </Link>
            <Link
              href="/faq"
              className={cn(
                "text-sm font-medium transition-colors hover:text-primary",
                pathname === "/faq" && "text-primary font-bold"
              )}
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
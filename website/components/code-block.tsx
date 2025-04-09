"use client";
import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import dynamic from 'next/dynamic';
import { useTheme } from "next-themes";

// Dynamically import SyntaxHighlighter with no SSR to prevent hydration mismatch
const SyntaxHighlighter = dynamic(
  () => import('react-syntax-highlighter').then(mod => mod.Prism),
  { ssr: false }
);

// Dynamically import styles with no SSR
const getStyles = async () => {
  const styles = await import('react-syntax-highlighter/dist/esm/styles/prism');
  return { vscDarkPlus: styles.vscDarkPlus, vs: styles.vs };
};

interface CodeBlockProps {
  code: string
  language?: string
  title?: string
  className?: string
}

export function CodeBlock({ code, language = "bash", title, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [styles, setStyles] = useState<any>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  
  // Load styles on the client side
  React.useEffect(() => {
    getStyles().then(loadedStyles => {
      setStyles(loadedStyles);
    });
  }, []);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("border border-border rounded-lg overflow-hidden dark:border-gray-700", className)}>
      {title && (
        <div className="bg-muted py-3 px-4 border-b border-border dark:bg-gray-800 dark:border-gray-700">
          <p className="text-sm font-medium dark:text-gray-300">{title}</p>
        </div>
      )}
      <div className="relative">
        {styles ? (
          <SyntaxHighlighter
            language={language}
            style={isDark ? styles.vscDarkPlus : styles.vs}
            customStyle={{
              margin: 0,
              padding: "1rem",
              backgroundColor: isDark ? "#171717" : undefined,
              borderRadius: 0
            }}
            codeTagProps={{
              className: "text-sm font-mono"
            }}
          >
            {code}
          </SyntaxHighlighter>
        ) : (
          <div className="p-4 bg-card dark:bg-gray-900">
            <pre className="text-sm text-card-foreground dark:text-gray-300 font-mono whitespace-pre">
              <code>{code}</code>
            </pre>
          </div>
        )}
        <button
          onClick={copyToClipboard}
          className="absolute right-2 top-2 rounded-md p-1.5 bg-muted/70 hover:bg-muted/90 text-muted-foreground dark:bg-gray-800/70 dark:hover:bg-gray-800 transition-colors"
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
} 
import React, { useEffect, useRef, useState } from 'react';
import hljs from 'highlight.js/lib/core';
import sql from 'highlight.js/lib/languages/sql';
import javascript from 'highlight.js/lib/languages/javascript';
import { Copy, Check } from 'lucide-react';

hljs.registerLanguage('sql', sql as any);
hljs.registerLanguage('javascript', javascript as any);

interface CodeBlockProps {
  code: string;
  language: string;
  className?: string;
  showLineNumbers?: boolean;
  errorAnnotations?: Array<{ line: number; message: string }>;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language, className, showLineNumbers, errorAnnotations }) => {
  const codeRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  const errorLineSet = new Set((errorAnnotations ?? []).map(a => a.line));
  const errorMessageMap = new Map((errorAnnotations ?? []).map(a => [a.line, a.message]));

  useEffect(() => {
    if (codeRef.current) {
      delete codeRef.current.dataset.highlighted;
      hljs.highlightElement(codeRef.current);
    }
  }, [code, language, showLineNumbers]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 400);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  return (
    <div className={`relative group w-full ${className || ''}`}>
      <div className="relative w-full bg-[var(--vscode-editor-background)] rounded-lg border border-[var(--vscode-widget-border)] overflow-hidden">
        <button
          onClick={handleCopy}
          className="absolute top-3 right-3 p-1.5 rounded bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-md border border-[var(--vscode-widget-border)]"
          style={{ right: '12px' }}
          title="Copy code"
        >
          {copied ? (
            <div className="flex items-center space-x-1 px-1">
              <Check className="w-3.5 h-3.5 text-[var(--vscode-extensionIcon-preReleaseForeground)]" />
              <span className="text-[10px]">Copied</span>
            </div>
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
        {showLineNumbers ? (
          <div className="overflow-x-auto p-4 pt-10 flex">
            <pre
              aria-hidden="true"
              className="select-none text-right pr-4 shrink-0 m-0 p-0 bg-transparent border-0"
            >
              {code.split('\n').map((_, i) => {
                const lineNum = i + 1;
                const hasError = errorLineSet.has(lineNum);
                return (
                  <React.Fragment key={i}>
                    <span className={hasError
                      ? 'text-red-500 font-bold'
                      : 'text-[var(--vscode-editorLineNumber-foreground)] opacity-50'
                    }>
                      {hasError ? '▶' : lineNum}
                    </span>
                    {'\n'}
                  </React.Fragment>
                );
              })}
            </pre>
            <pre className="flex-1 min-w-0 m-0 p-0 bg-transparent border-0 overflow-visible">
              <code ref={codeRef} className={`language-${language}`}>
                {code}
              </code>
            </pre>
            {errorAnnotations && errorAnnotations.length > 0 && (
              <pre
                aria-hidden="true"
                className="shrink-0 pl-6 text-red-500 opacity-80 m-0 p-0 bg-transparent border-0 select-none"
              >
                {code.split('\n').map((_, i) => {
                  const lineNum = i + 1;
                  const msg = errorMessageMap.get(lineNum);
                  const truncated = msg && msg.length > 60 ? msg.slice(0, 60) + '…' : msg;
                  return (
                    <React.Fragment key={i}>
                      <span title={msg || undefined}>{truncated ?? ''}</span>
                      {'\n'}
                    </React.Fragment>
                  );
                })}
              </pre>
            )}
          </div>
        ) : (
          <pre className="overflow-x-auto p-4 pt-10">
            <code ref={codeRef} className={`language-${language}`}>
              {code}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
};

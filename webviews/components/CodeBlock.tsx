import React, { useState } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import { Copy, Check } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language: string;
  className?: string;
  showLineNumbers?: boolean;
  errorAnnotations?: Array<{ line: number; message: string }>;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language,
  className,
  showLineNumbers,
  errorAnnotations
}) => {
  const [copied, setCopied] = useState(false);

  // O(1) lookup for error messages
  const errorMessageMap = new Map((errorAnnotations ?? []).map(a => [a.line, a.message]));

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000); // 2 seconds is standard for copy feedback
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  return (
    <div className={`relative group w-full ${className || ''}`}>
      <div className="relative w-full bg-[var(--vscode-editor-background)] rounded-lg border border-[var(--vscode-widget-border)] overflow-hidden font-mono text-sm text-[var(--vscode-editor-foreground)]">
        
        {/* Copy Button */}
        <button
          onClick={handleCopy}
          className="absolute top-3 right-3 p-1.5 rounded bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-md border border-[var(--vscode-widget-border)] flex items-center justify-center"
          title="Copy code"
        >
          {copied ? (
            <div className="flex items-center space-x-1 px-1">
              <Check className="w-3.5 h-3.5 text-[var(--vscode-debugIcon-successForeground)]" />
              <span className="text-[10px]">Copied</span>
            </div>
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Code Rendering */}
        <Highlight
          theme={themes.vsDark} // Falls back beautifully into standard VS Code colors
          code={code}
          language={language as any}
        >
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className={`${className} overflow-x-auto p-4 pt-10 m-0 bg-transparent`}
              style={{ ...style, backgroundColor: 'transparent' }} // Force transparent to rely on VS Code theme
            >
              <div className="table w-full">
                {tokens.map((line, i) => {
                  const lineNum = i + 1;
                  const errorMsg = errorMessageMap.get(lineNum);
                  const hasError = !!errorMsg;

                  return (
                    <div
                      key={i}
                      {...getLineProps({ line, key: i })}
                      className={`table-row hover:bg-[var(--vscode-editor-lineHighlightBackground)] transition-colors ${
                        hasError ? 'bg-[var(--vscode-inputValidation-errorBackground)] bg-opacity-20' : ''
                      }`}
                    >
                      {/* Column 1: Line Numbers */}
                      {showLineNumbers && (
                        <span 
                          className={`table-cell text-right pr-4 select-none w-8 ${
                            hasError ? 'text-[var(--vscode-errorForeground)] font-bold' : 'text-[var(--vscode-editorLineNumber-foreground)] opacity-50'
                          }`}
                        >
                          {hasError ? '▶' : lineNum}
                        </span>
                      )}

                      {/* Column 2: Code Output */}
                      <span className="table-cell whitespace-pre break-words">
                        {line.map((token, key) => (
                          <span key={key} {...getTokenProps({ token, key })} />
                        ))}
                        {errorMsg && (
                          <span className="pl-6 text-[var(--vscode-errorForeground)] opacity-80 select-none text-xs italic align-middle inline-block">
                            // {errorMsg}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </pre>
          )}
        </Highlight>
      </div>
    </div>
  );
};
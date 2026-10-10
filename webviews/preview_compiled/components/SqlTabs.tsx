import clsx from "clsx";
import { CodeBlock } from "../../components/CodeBlock";

export interface SqlBlock {
  key: string;
  label: string;
  /** What the SQL builds, for the tab's tooltip */
  target: string;
  code: string;
  /** The query the action is for, which is the one shown first: not what runs before or after it */
  main: boolean;
  /** What is said where there is no SQL */
  none: string;
  annotations?: { line: number; message: string }[];
  /** Its dry run failed: the tab has a dot */
  failed: boolean;
  /** A word on the tab for SQL that is not what it would be taken for, e.g. "as written" */
  note?: { text: string; title: string };
}

/** The tab's label. Two blocks of a kind are told apart by what they build */
export function sqlTabLabels(blocks: SqlBlock[], nameOf: (block: SqlBlock) => string = (block) => block.target.slice(block.target.lastIndexOf(".") + 1)): (block: SqlBlock) => string {
  const counts = blocks.reduce<Record<string, number>>((all, block) => ({ ...all, [block.label]: (all[block.label] ?? 0) + 1 }), {});
  return (block) => counts[block.label] > 1 ? `${nameOf(block)} · ${block.label}` : block.label;
}

/** The block on show: the one chosen, else the first main one */
export function shownSqlBlock<Block extends SqlBlock>(blocks: Block[], chosen: string | null): Block | undefined {
  return blocks.find((block) => block.key === chosen) ?? blocks.find((block) => block.main) ?? blocks[0];
}

interface SqlTabsProps {
  blocks: SqlBlock[];
  shown: SqlBlock;
  onShow: (key: string) => void;
  labelOf: (block: SqlBlock) => string;
  /** The SQL is of the compile before the one that runs */
  dimmed?: boolean;
}

/** The queries a file compiles to, as tabs over one code block. They run from edge to edge of a panel padded by 1rem */
export function SqlTabs({ blocks, shown, onShow, labelOf, dimmed }: SqlTabsProps) {
  return (
    <>
      <div role="tablist" aria-label="Compiled SQL" className="sticky top-0 z-10 -mx-4 px-2 flex items-center gap-1 h-9 overflow-x-auto scrollbar-thin border-b border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)]">
        {blocks.map((block) => (
          <button
            key={block.key}
            role="tab"
            aria-selected={block === shown}
            onClick={() => onShow(block.key)}
            title={block.failed ? `${block.target}: its dry run failed` : block.target}
            className={clsx(
              "flex items-center gap-1.5 flex-shrink-0 h-6 px-2 rounded text-[12.5px] whitespace-nowrap border-0 transition-colors",
              block === shown
                ? "bg-[var(--vscode-list-inactiveSelectionBackground,var(--vscode-toolbar-hoverBackground))] text-[var(--vscode-foreground)]"
                : "bg-transparent text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
            )}
          >
            {block.failed && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[var(--vscode-errorForeground,#f14c4c)]" />}
            {labelOf(block)}
            {block.note && <span title={block.note.title} className="px-1 rounded border border-[var(--vscode-widget-border)] text-[9.5px] font-mono uppercase tracking-wider leading-4 text-[var(--vscode-descriptionForeground)]">{block.note.text}</span>}
          </button>
        ))}
        <span className="ml-2 min-w-0 truncate text-[11px] font-mono text-[var(--vscode-descriptionForeground)] opacity-60">{shown.target}</span>
      </div>
      <div role="tabpanel" className={clsx("-mx-4", dimmed && "opacity-50")}>
        {shown.code ? (
          <CodeBlock key={shown.key} code={shown.code} language="sql" showLineNumbers errorAnnotations={shown.annotations} />
        ) : (
          <p className="px-4 py-3 text-sm text-[var(--vscode-descriptionForeground)] italic">{shown.none}</p>
        )}
      </div>
    </>
  );
}

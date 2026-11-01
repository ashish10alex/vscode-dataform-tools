import { diffNames } from './nameDiff';

/*
 * The hover of a ref that defer to prod reads from prod or from dev, as Markdown with the few HTML styles a VS Code
 * hover keeps: a span's colour and background, as a theme colour, and its corner radius. So the dev and prod names
 * are coloured like a diff, and the part they differ in (a table prefix, a schema suffix) is highlighted as the
 * compiled query panel does. It needs `supportHtml` and `supportThemeIcons` on the MarkdownString.
 */

/** The colour of the heading: that of the label after the ref */
export type DeferHoverTone = 'prod' | 'warning' | 'dev';

const TONE_COLOR: Record<DeferHoverTone, string> = {
    prod: 'var(--vscode-dataformTools-deferredRef-foreground)',
    warning: 'var(--vscode-dataformTools-deferredRefWarning-foreground)',
    dev: 'var(--vscode-dataformTools-builtInDevRef-foreground)',
};
const DEV_COLOR = 'var(--vscode-gitDecoration-deletedResourceForeground)';
const PROD_COLOR = 'var(--vscode-gitDecoration-addedResourceForeground)';
const PLAIN_COLOR = 'var(--vscode-descriptionForeground)';
const REMOVED_BACKGROUND = 'var(--vscode-diffEditor-removedTextBackground)';
const INSERTED_BACKGROUND = 'var(--vscode-diffEditor-insertedTextBackground)';

/** Text as HTML that Markdown leaves as it is: no tag, no emphasis, no link and no theme icon is made of it */
export function hoverText(text: string): string {
    return text.replace(/[&<>"'_*`[\]\\~$|#]/g, (character) => `&#${character.charCodeAt(0)};`);
}

function colored(text: string, color: string): string {
    return `<span style="color:${color};">${text}</span>`;
}

function highlighted(text: string, background: string): string {
    return text ? `<span style="background-color:${background};border-radius:3px;">${hoverText(text)}</span>` : '';
}

/** A line naming a table: its label, padded so the names of two lines start together, and the name */
function tableLine(label: string, color: string, name: string): string {
    return `<code>${colored(label.padEnd(4, ' '), color)} ${name}</code>`;
}

export interface DeferHover {
    tone: DeferHoverTone;
    /** A codicon name, e.g. `arrow-right` */
    icon: string;
    /** What the ref reads, in a word or two: "prod", "dev", "declaration" */
    heading: string;
    /** What is happening, as a sentence */
    sentence: string;
    /** `project.dataset.name` of the dev table */
    dev?: string;
    /** `project.dataset.name` of the prod table, when it has one */
    prod?: string;
    /** One table that is both, as for a declaration: shown alone, labelled "table" */
    table?: string;
    /** Markdown under the tables: a time, a link */
    footer?: string[];
    /** The small caps after the heading */
    caption?: string;
}

/** The hover, as Markdown with HTML */
export function deferHoverMarkdown(hover: DeferHover): string {
    const heading = `${colored(`$(${hover.icon}) <strong>${hoverText(hover.heading)}</strong>`, TONE_COLOR[hover.tone])} &nbsp;<small>${hoverText(hover.caption ?? 'DEFER TO PROD')}</small>`;
    const lines: string[] = [];
    if (hover.dev && hover.prod) {
        const diff = diffNames(hover.dev, hover.prod);
        lines.push(tableLine('dev', DEV_COLOR, hoverText(diff.prefix) + highlighted(diff.before, REMOVED_BACKGROUND) + hoverText(diff.suffix)));
        lines.push(tableLine('prod', PROD_COLOR, hoverText(diff.prefix) + highlighted(diff.after, INSERTED_BACKGROUND) + hoverText(diff.suffix)));
    } else if (hover.dev) {
        lines.push(tableLine('dev', PLAIN_COLOR, hoverText(hover.dev)));
    }
    if (hover.table) {
        lines.push(tableLine('table', PLAIN_COLOR, hoverText(hover.table)));
    }
    return [heading, hoverText(hover.sentence), lines.join('<br>'), ...(hover.footer ?? [])].filter(Boolean).join('\n\n');
}

import { search } from "@inquirer/prompts";
import type { DependancyModelMetadata } from "../../../src/types";

/**
 * Translate Ctrl+N / Ctrl+J → ↓, Ctrl+P / Ctrl+K → ↑ for the duration of an
 * inquirer prompt. Implemented by mutating the `key` object that node's
 * readline emits on the `keypress` event *before* inquirer's own listener runs.
 *
 * Safe because node's readline gives the real Enter key (`\r`) name "return"
 * and Ctrl+J (`\n`) name "enter" — they are distinguishable, so remapping
 * "enter" does not break submission.
 *
 * Returns a teardown function.
 */
function installVimKeyBindings(): () => void {
    type Key = { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string };
    const DOWN_SEQ = "\x1b[B";
    const UP_SEQ = "\x1b[A";

    const onKeypress = (_str: string, key: Key | undefined) => {
        if (!key) {return;}
        // Ctrl+J — readline names this "enter" (LF, distinct from Enter key's "return").
        if (key.name === "enter") {
            key.name = "down";
            key.sequence = DOWN_SEQ;
            return;
        }
        if (!key.ctrl) {return;}
        if (key.name === "n" || key.name === "j") {
            key.name = "down";
            key.ctrl = false;
            key.meta = false;
            key.shift = false;
            key.sequence = DOWN_SEQ;
        } else if (key.name === "p" || key.name === "k") {
            key.name = "up";
            key.ctrl = false;
            key.meta = false;
            key.shift = false;
            key.sequence = UP_SEQ;
        }
    };

    // prependListener so we run before any listener inquirer installs.
    process.stdin.prependListener("keypress", onKeypress);
    return () => {
        process.stdin.off("keypress", onKeypress);
    };
}

// `data.type` can come from either the dataform struct's own `type` field
// (singular: "table", "view", "incremental", "operation", "assertion") or
// fall back to the category name (plural: "operations", "assertions", "declarations").
const TYPE_LABEL: Record<string, string> = {
    table: "table",
    view: "view",
    incremental: "incremental",
    operation: "operation",
    operations: "operation",
    assertion: "assertion",
    assertions: "assertion",
    declaration: "source",
    declarations: "source",
};

function typeLabel(raw: string): string {
    return TYPE_LABEL[raw] ?? raw;
}

function isUserCancellation(err: unknown): boolean {
    if (!err || typeof err !== "object") {return false;}
    const e = err as { name?: string; code?: string };
    return e.name === "ExitPromptError" || e.code === "ERR_USE_AFTER_CLOSE";
}

/**
 * Two-step interactive picker:
 *   1. Choose the source file (only files that produce at least one node).
 *   2. Choose a model from that file (skipped automatically if the file
 *      produces only one model — common case for plain tables/views).
 *
 * Returns the chosen node id, or null if the user cancels at any step.
 */
/**
 * Interactive filterable picker over a list of tag names.
 * Returns the chosen tag, or null if the user cancels.
 */
export async function pickTag(tags: string[]): Promise<string | null> {
    if (tags.length === 0) {
        throw new Error("No tags found in the compiled graph — nothing to filter by.");
    }

    const sorted = [...tags].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const restoreKeys = installVimKeyBindings();
    try {
        const chosen = await search<string>({
            message: `Select a tag (${tags.length} total):`,
            source: (input) => {
                const q = (input ?? "").trim().toLowerCase();
                const filtered = q ? sorted.filter((t) => t.toLowerCase().includes(q)) : sorted;
                return filtered.slice(0, 100).map((t) => ({ name: t, value: t }));
            },
        });
        return chosen;
    } catch (err) {
        if (isUserCancellation(err)) {return null;}
        throw err;
    } finally {
        restoreKeys();
    }
}

export async function pickModel(nodes: DependancyModelMetadata[]): Promise<string | null> {
    if (nodes.length === 0) {
        throw new Error("No models found in the compiled graph — nothing to focus on.");
    }

    const restoreKeys = installVimKeyBindings();
    try {
        return await pickModelInner(nodes);
    } finally {
        restoreKeys();
    }
}

async function pickModelInner(nodes: DependancyModelMetadata[]): Promise<string | null> {
    // Group nodes by source file. A single .sqlx can produce multiple nodes
    // (e.g. the table itself plus an assertion).
    const byFile = new Map<string, DependancyModelMetadata[]>();
    for (const node of nodes) {
        const file = node.data.fileName || "(unknown)";
        let group = byFile.get(file);
        if (!group) {
            group = [];
            byFile.set(file, group);
        }
        group.push(node);
    }

    const files = Array.from(byFile.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    let chosenFile: string;
    try {
        chosenFile = await search<string>({
            message: `Select a source file (${files.length} total):`,
            source: (input) => {
                const q = (input ?? "").trim().toLowerCase();
                const filtered = q ? files.filter((f) => f.toLowerCase().includes(q)) : files;
                return filtered.slice(0, 100).map((file) => {
                    const count = byFile.get(file)!.length;
                    return {
                        name: count > 1 ? `${file}  (${count} models)` : file,
                        value: file,
                    };
                });
            },
        });
    } catch (err) {
        if (isUserCancellation(err)) {return null;}
        throw err;
    }

    const candidates = byFile.get(chosenFile)!;

    // Auto-pass when the file only produces a single model.
    if (candidates.length === 1) {
        return candidates[0].id;
    }

    // Stable, deterministic order within a file: by fully-qualified name.
    const sorted = [...candidates].sort((a, b) =>
        a.data.fullTableName < b.data.fullTableName ? -1 : a.data.fullTableName > b.data.fullTableName ? 1 : 0
    );

    try {
        const chosen = await search<string>({
            message: `Select a model from ${chosenFile}:`,
            source: (input) => {
                const q = (input ?? "").trim().toLowerCase();
                const filtered = q
                    ? sorted.filter(
                          (n) =>
                              n.data.fullTableName.toLowerCase().includes(q) ||
                              typeLabel(n.data.type).toLowerCase().includes(q)
                      )
                    : sorted;
                return filtered.map((n) => ({
                    name: `${n.data.fullTableName}  [${typeLabel(n.data.type)}]`,
                    value: n.id,
                }));
            },
        });
        return chosen;
    } catch (err) {
        if (isUserCancellation(err)) {return null;}
        throw err;
    }
}

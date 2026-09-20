// Pure helpers for working with nested BigQuery schemas (RECORD / STRUCT fields).
// Must not import `vscode` at runtime: this module is shared with the webviews.
import type { Column, ColumnMetadata } from "../types";

/** Separator used to build a unique key from a column path. Column names cannot contain it. */
const PATH_SEPARATOR = "\u0000";

export function pathKey(path: string[]): string {
    return path.join(PATH_SEPARATOR);
}

/**
 * Returns a copy of `fields` where each field's description is taken from the Dataform
 * `columns` config entry with the same full path (e.g. [parent, child]), at any depth.
 * `mode` and nested `fields` are preserved. The input is not mutated.
 */
export function applyColumnDescriptions(fields: ColumnMetadata[], columns: Column[]): ColumnMetadata[] {
    const descriptionsByPath = new Map<string, string>();
    for (const column of columns) {
        if (column?.path?.length) {
            descriptionsByPath.set(pathKey(column.path), column.description || "");
        }
    }

    const walk = (current: ColumnMetadata[], parentPath: string[]): ColumnMetadata[] =>
        current.map((field) => {
            const path = [...parentPath, field.name];
            const copy: ColumnMetadata = { ...field };
            const description = descriptionsByPath.get(pathKey(path));
            if (description !== undefined) {
                copy.description = description;
            }
            if (field.fields) {
                copy.fields = walk(field.fields, path);
            }
            return copy;
        });

    return walk(fields, []);
}

/** Depth-first list of every field at every depth, identified by its own name. */
export function flattenSchemaFields(fields: ColumnMetadata[]): { name: string; type: string; description?: string }[] {
    const out: { name: string; type: string; description?: string }[] = [];
    const walk = (current: ColumnMetadata[]) => {
        for (const field of current) {
            out.push({ name: field.name, type: field.type, description: field.description });
            if (field.fields) {
                walk(field.fields);
            }
        }
    };
    walk(fields);
    return out;
}

export interface ColumnsConfig {
    [name: string]: string | { description: string; columns: ColumnsConfig };
}

/**
 * Builds a Dataform `columns` config object. Fields without children map to their description;
 * fields with children map to `{ description, columns }`.
 * `descriptionsByPath` (keyed by `pathKey`) overrides the field's own description.
 */
export function buildColumnsConfig(
    fields: ColumnMetadata[],
    descriptionsByPath: Record<string, string> = {},
    parentPath: string[] = []
): ColumnsConfig {
    const config: ColumnsConfig = {};
    for (const field of fields) {
        const path = [...parentPath, field.name];
        const key = pathKey(path);
        const description = descriptionsByPath[key] !== undefined ? descriptionsByPath[key] : (field.description || "");
        if (field.fields && field.fields.length > 0) {
            config[field.name] = {
                description,
                columns: buildColumnsConfig(field.fields, descriptionsByPath, path),
            };
        } else {
            config[field.name] = description;
        }
    }
    return config;
}

/** Formats an object as JSON-like text with unquoted keys, suitable for pasting into a SQLX config block. */
export function formatAsUnquotedJson(obj: Record<string, unknown>, indent = ""): string {
    const lines = Object.entries(obj).map(([key, value]) => {
        const formatted = value !== null && typeof value === "object"
            ? formatAsUnquotedJson(value as Record<string, unknown>, indent + "  ")
            : JSON.stringify(value);
        return `${indent}  ${key}: ${formatted}`;
    });
    return `{\n${lines.join(",\n")}\n${indent}}`;
}

/** A field rendered as one row of a flat list, keeping the depth it sat at in the tree. */
export interface SchemaRowForDisplay {
    /** The field's own name, not its full path. */
    name: string;
    /** The field type, with the mode appended when it is not NULLABLE, e.g. `RECORD REPEATED`. */
    type: string;
    description: string;
    /** 0 for top level fields, 1 for the children of a RECORD, and so on. */
    depth: number;
    /** Full path from the root, e.g. ["ALL_ATTRIBUTES", "ATTR_CODE"]. */
    path: string[];
}

/** BigQuery omits mode for NULLABLE fields, so only other modes are worth showing. */
const displayType = (field: ColumnMetadata): string => {
    const type = field.type || "";
    return field.mode && field.mode !== "NULLABLE" ? `${type} ${field.mode}`.trim() : type;
};

const countFields = (fields: ColumnMetadata[]): number =>
    fields.reduce((total, field) => total + 1 + (field.fields ? countFields(field.fields) : 0), 0);

/**
 * Depth first list of every field at every depth, each parent immediately followed by its
 * children, siblings sorted by name. Stops after `maxRows` rows and reports how many fields
 * (including the descendants of the fields it stopped at) were left out. The input is not mutated.
 */
export function flattenSchemaRows(
    fields: ColumnMetadata[],
    options: { maxRows?: number } = {}
): { rows: SchemaRowForDisplay[]; omitted: number } {
    const maxRows = options.maxRows ?? Infinity;
    const rows: SchemaRowForDisplay[] = [];
    let omitted = 0;

    const walk = (current: ColumnMetadata[], parentPath: string[]) => {
        const siblings = [...current].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        for (const field of siblings) {
            if (rows.length >= maxRows) {
                omitted += countFields([field]);
                continue;
            }
            const path = [...parentPath, field.name || ""];
            rows.push({
                name: field.name || "",
                type: displayType(field),
                description: field.description || "",
                depth: parentPath.length,
                path,
            });
            if (field.fields?.length) {
                walk(field.fields, path);
            }
        }
    };

    walk(fields, []);
    return { rows, omitted };
}

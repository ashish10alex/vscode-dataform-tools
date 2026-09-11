import type {
    DataformCompiledJson,
    PropertyGraph,
    PropertyGraphEntity,
    PropertyGraphLabel,
    PropertyGraphRelationship,
    PropertyGraphValidation,
    Target,
} from "../types";

/**
 * Pure helpers shared between the extension host and the preview webview.
 * Must stay free of `vscode` imports so the webview bundle can import it.
 */

/** PropertyGraph actions first appear in the compiled graph in this version. */
export const PROPERTY_GRAPHS_MIN_CORE_VERSION = "3.0.65";

/**
 * The wrapper we put around `graphBody` to get something BigQuery will parse.
 *
 * The compiler only hands us the `NODE TABLES (...) EDGE TABLES (...)` body, never a
 * runnable statement, so this header is our reconstruction rather than Dataform's own.
 * It is deliberately the only place the wrapper exists, it is always shown to the user
 * alongside any validation result, and a failure attributed to these lines is reported
 * as an extension problem instead of a problem with the user's graph.
 *
 * Verified against @dataform/core 3.0.69.
 */
const CREATE_STATEMENT_HEADER = (targetName: string) =>
    `CREATE OR REPLACE PROPERTY GRAPH \`${targetName}\``;

export function fullTargetName(target: Target): string {
    return `${target.database}.${target.schema}.${target.name}`;
}

function parseSemver(version: string): number[] {
    return version
        .replace(/^[^0-9]*/, "")
        .split(".")
        .map((part) => parseInt(part, 10) || 0);
}

/** True when `version` is greater than or equal to `minimum`. Unknown versions are optimistic. */
export function isCoreVersionAtLeast(version: string | undefined, minimum: string): boolean {
    if (!version) {
        return true;
    }
    const actual = parseSemver(version);
    const required = parseSemver(minimum);
    for (let i = 0; i < required.length; i++) {
        const a = actual[i] ?? 0;
        const r = required[i] ?? 0;
        if (a !== r) {
            return a > r;
        }
    }
    return true;
}

/**
 * Files that could hold a property graph definition. Used to decide whether an empty
 * compiled result deserves the "your core is too old" hint rather than a generic error.
 */
export function isPropertyGraphCandidateFile(relativeFilePath: string | undefined): boolean {
    if (!relativeFilePath) {
        return false;
    }
    const normalised = relativeFilePath.replace(/\\/g, "/");
    if (!normalised.endsWith(".yaml") && !normalised.endsWith(".yml")) {
        return false;
    }
    // workflow_settings.yaml is a config file and handled elsewhere
    if (normalised.split("/").pop()?.startsWith("workflow_settings")) {
        return false;
    }
    return normalised.startsWith("definitions/") || normalised.includes("/definitions/");
}

export function getPropertyGraphsForFile(
    relativeFilePath: string | undefined,
    compiledJson: DataformCompiledJson | undefined,
): PropertyGraph[] {
    if (!relativeFilePath || !compiledJson?.propertyGraphs) {
        return [];
    }
    const normalised = relativeFilePath.replace(/\\/g, "/");
    return compiledJson.propertyGraphs.filter(
        (graph) => graph.fileName?.replace(/\\/g, "/") === normalised,
    );
}

/**
 * Synthesise the statement used to validate a graph. `bodyStartLine` is the 1-indexed
 * line of `statement` where `graphBody` begins, so a BigQuery error location can be
 * mapped back onto the body the user actually wrote.
 */
export function buildPropertyGraphCreateStatement(graph: PropertyGraph): {
    statement: string;
    bodyStartLine: number;
} {
    const header = CREATE_STATEMENT_HEADER(fullTargetName(graph.target));
    const headerLineCount = header.split("\n").length;
    return {
        statement: `${header}\n${graph.graphBody ?? ""}`,
        bodyStartLine: headerLineCount + 1,
    };
}

/**
 * Turn a BigQuery dry run failure into something attributable. Errors landing on the
 * synthesised header are ours, not the user's, and are flagged as such.
 */
export function classifyPropertyGraphDryRunError(
    bodyStartLine: number,
    message: string,
    errorLine: number | undefined,
): Pick<PropertyGraphValidation, "message" | "graphBodyLine" | "harnessError"> {
    const mentionsWrapper = /\b(CREATE|PROPERTY GRAPH)\b/i.test(message)
        && /syntax error|unexpected|not supported/i.test(message);
    const landsOnHeader = errorLine !== undefined && errorLine > 0 && errorLine < bodyStartLine;

    if (landsOnHeader || (mentionsWrapper && errorLine === undefined)) {
        return {
            message,
            harnessError: true,
        };
    }

    return {
        message,
        graphBodyLine: errorLine && errorLine >= bodyStartLine ? errorLine - bodyStartLine + 1 : undefined,
        harnessError: false,
    };
}

export function defaultLabelOf(
    element: PropertyGraphEntity | PropertyGraphRelationship,
): PropertyGraphLabel | undefined {
    return element.labels?.find((label) => label.isDefault) ?? element.labels?.[0];
}

/** True when the element exposes every column of its backing table as a property. */
export function elementImportsAllColumns(
    element: PropertyGraphEntity | PropertyGraphRelationship,
): boolean {
    return defaultLabelOf(element)?.importAll === true;
}

/**
 * Property names known from the compiled output alone, i.e. without reading the backing
 * table's schema from BigQuery.
 *
 * For an `importAll` element the compiler tells us nothing about the columns, so the key
 * columns are all we can name. For an element with explicit field mappings only the mapped
 * names are exposed as properties — the key columns are not, unless they were mapped too.
 */
export function knownPropertyNames(
    element: PropertyGraphEntity | PropertyGraphRelationship,
): string[] {
    const label = defaultLabelOf(element);
    if (label?.importAll) {
        return [...(element.keys ?? [])];
    }
    return (label?.fields ?? []).map((field) => field.name);
}

/** Row cap on generated starter queries; shared so the query and its explanation agree. */
export const DEFAULT_GQL_ROW_LIMIT = 100;

export interface GqlAliasMap {
    source: string;
    edge: string;
    destination: string;
}

/** Element name -> selected property names, the single source of truth for the RETURN clause. */
export type GqlSelection = Record<string, string[]>;

export interface GqlQuerySpec {
    relationshipName: string;
    sourceEntityName: string;
    destinationEntityName: string;
    aliases: GqlAliasMap;
    /**
     * Selection the query starts from. Derived only from compiled output so it never
     * changes underneath the user when a backing table's schema is read later.
     */
    defaultSelection: GqlSelection;
}

function aliasFor(name: string, taken: Set<string>): string {
    const base = (name.match(/[a-zA-Z]/)?.[0] ?? "n").toLowerCase();
    let candidate = base;
    let suffix = 1;
    while (taken.has(candidate)) {
        candidate = `${base}${suffix++}`;
    }
    taken.add(candidate);
    return candidate;
}

export function buildGqlQuerySpecs(graph: PropertyGraph): GqlQuerySpec[] {
    const entitiesByName = new Map((graph.entities ?? []).map((entity) => [entity.name, entity]));

    return (graph.relationships ?? []).map((relationship) => {
        const source = entitiesByName.get(relationship.source?.entity);
        const destination = entitiesByName.get(relationship.destination?.entity);

        const taken = new Set<string>();
        const aliases: GqlAliasMap = {
            source: aliasFor(relationship.source?.entity ?? "source", taken),
            edge: aliasFor(relationship.name, taken),
            destination: aliasFor(relationship.destination?.entity ?? "destination", taken),
        };

        const defaultSelection: GqlSelection = {};
        if (source) { defaultSelection[source.name] = knownPropertyNames(source); }
        defaultSelection[relationship.name] = knownPropertyNames(relationship);
        if (destination && destination.name !== source?.name) {
            defaultSelection[destination.name] = knownPropertyNames(destination);
        }

        return {
            relationshipName: relationship.name,
            sourceEntityName: relationship.source?.entity ?? "",
            destinationEntityName: relationship.destination?.entity ?? "",
            aliases,
            defaultSelection,
        };
    });
}

/**
 * Render a runnable starter query. The RETURN clause is a pure function of `selection`,
 * so reading a backing table's schema can never rewrite a query on its own — only an
 * explicit change to the selection does.
 */
export function buildGqlQuery(
    graph: PropertyGraph,
    spec: GqlQuerySpec,
    selection: GqlSelection,
    rowLimit = DEFAULT_GQL_ROW_LIMIT,
): string {
    const graphName = fullTargetName(graph.target);
    const pattern =
        `(${spec.aliases.source}:${spec.sourceEntityName})`
        + `-[${spec.aliases.edge}:${spec.relationshipName}]->`
        + `(${spec.aliases.destination}:${spec.destinationEntityName})`;

    const parts: { elementName: string; alias: string }[] = [
        { elementName: spec.sourceEntityName, alias: spec.aliases.source },
        { elementName: spec.relationshipName, alias: spec.aliases.edge },
        { elementName: spec.destinationEntityName, alias: spec.aliases.destination },
    ];

    const returnItems: string[] = [];
    for (const { elementName, alias } of parts) {
        for (const property of selection[elementName] ?? []) {
            const item = `${alias}.${property}`;
            if (!returnItems.includes(item)) {
                returnItems.push(item);
            }
        }
    }

    // A RETURN clause is mandatory; fall back to a constant rather than emitting invalid GQL.
    const returnClause = returnItems.length > 0 ? returnItems.join(", ") : "1 AS matched";

    return [
        "SELECT *",
        "FROM GRAPH_TABLE(",
        `  \`${graphName}\``,
        `  MATCH ${pattern}`,
        `  RETURN ${returnClause}`,
        ")",
        `LIMIT ${rowLimit}`,
    ].join("\n");
}

import React, { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Loader2,
  Play,
  Tag,
} from "lucide-react";
import clsx from "clsx";
import { CodeBlock } from "../../components/CodeBlock";
import { BigQueryTableLink } from "../../components/BigQueryTableLink";
import { vscode } from "../utils/vscode";
import type { PropertyGraph, PropertyGraphValidation, WebviewState } from "../types";
import type { PropertyGraphEntity, PropertyGraphRelationship } from "../../../src/types";
import {
  buildGqlQuery,
  buildGqlQuerySpecs,
  defaultLabelOf,
  elementImportsAllColumns,
  fullTargetName,
  knownPropertyNames,
  type GqlSelection,
} from "../../../src/shared/propertyGraph";
import { PropertyGraphDiagram, PropertyList, type GraphElementView } from "./PropertyGraphDiagram";

function toElementView(
  element: PropertyGraphEntity | PropertyGraphRelationship,
  kind: "entity" | "relationship",
  schemas: WebviewState["propertyGraphElementSchemas"],
  requested: Record<string, boolean>,
  schemaKey: string,
): GraphElementView {
  const label = defaultLabelOf(element);
  const importAll = elementImportsAllColumns(element);
  const mappedFields = label?.fields ?? [];
  const fetched = schemas?.[schemaKey];

  let schemaState: GraphElementView["schemaState"] = "loaded";
  let availableProperties: string[] = mappedFields.map((field) => field.name);

  if (importAll) {
    if (fetched?.error) {
      schemaState = "error";
      availableProperties = [...(element.keys ?? [])];
    } else if (fetched) {
      schemaState = "loaded";
      const fetchedNames = fetched.columns.map((column) => column.name);
      const keys = (element.keys ?? []).filter((key) => fetchedNames.includes(key));
      availableProperties = [...keys, ...fetchedNames.filter((name) => !keys.includes(name))];
    } else if (requested[schemaKey]) {
      schemaState = "loading";
      availableProperties = [...(element.keys ?? [])];
    } else {
      schemaState = "idle";
      availableProperties = [...(element.keys ?? [])];
    }
  }

  return {
    kind,
    name: element.name,
    backingTable: fullTargetName(element.dataSource),
    keys: element.keys ?? [],
    importAll,
    mappedFields,
    availableProperties,
    schemaState,
    schemaError: fetched?.error,
  };
}

const ValidationBanner: React.FC<{ validation: PropertyGraphValidation | undefined; dryRunning: boolean }> = ({
  validation,
  dryRunning,
}) => {
  const [showStatement, setShowStatement] = useState(false);

  if (!validation) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--vscode-descriptionForeground)]">
        {dryRunning ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Validating graph against BigQuery...
          </>
        ) : null}
      </div>
    );
  }

  const tone =
    validation.state === "ok"
      ? "border-[var(--vscode-charts-green)]"
      : validation.state === "skipped"
        ? "border-[var(--vscode-widget-border)]"
        : "border-[var(--vscode-inputValidation-errorBorder)]";

  return (
    <div className={clsx("rounded-lg border-l-4 pl-3 py-2 bg-[var(--vscode-editor-background)]", tone)}>
      <div className="flex items-center gap-2 text-xs">
        {validation.state === "ok" && (
          <>
            <Check className="w-3.5 h-3.5 text-[var(--vscode-charts-green)]" />
            <span className="text-[var(--vscode-foreground)]">
              Graph validated against BigQuery — every key and property column resolves.
            </span>
          </>
        )}
        {validation.state === "skipped" && (
          <>
            <CircleSlash className="w-3.5 h-3.5 opacity-60" />
            <span className="text-[var(--vscode-descriptionForeground)]">{validation.message}</span>
          </>
        )}
        {validation.state === "error" && (
          <>
            <AlertTriangle className="w-3.5 h-3.5 text-[var(--vscode-errorForeground)] flex-shrink-0" />
            <span className="text-[var(--vscode-errorForeground)]">
              {validation.harnessError
                ? "Validation could not run: the statement this extension builds around the compiled graph body was rejected. This is an extension problem, not a problem with your graph."
                : "BigQuery rejected this graph"}
            </span>
          </>
        )}
      </div>

      {validation.state === "error" && (
        <pre className="mt-2 mr-3 text-[11px] font-mono whitespace-pre-wrap text-[var(--vscode-errorForeground)] opacity-90">
          {validation.message}
          {validation.graphBodyLine !== undefined && `\n(graph body line ${validation.graphBodyLine})`}
        </pre>
      )}

      <button
        type="button"
        onClick={() => setShowStatement((open) => !open)}
        className="mt-1.5 flex items-center text-[11px] text-[var(--vscode-textLink-foreground)] hover:underline"
      >
        {showStatement ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
        {showStatement ? "Hide" : "Show"} the statement used for validation
      </button>
      {showStatement && (
        <div className="mt-2 mr-3">
          <p className="text-[11px] text-[var(--vscode-descriptionForeground)] mb-1">
            Dataform does not expose a runnable statement, so this extension wraps the compiled graph
            body to dry run it. It is never executed and never written to your project.
          </p>
          <CodeBlock code={validation.statement} language="sql" showLineNumbers />
        </div>
      )}
    </div>
  );
};

const RelationshipCard: React.FC<{
  relationship: PropertyGraphRelationship;
  view: GraphElementView;
  selected: string[];
  isExpanded: boolean;
  onToggleExpand: (elementName: string) => void;
  onToggleProperty: (elementName: string, property: string) => void;
}> = ({ relationship, view, selected, isExpanded, onToggleExpand, onToggleProperty }) => (
  <div className="rounded-lg border border-[var(--vscode-widget-border)]/60 overflow-hidden">
    <button
      type="button"
      onClick={() => onToggleExpand(view.name)}
      className="w-full flex items-center px-3 py-2 text-left hover:bg-[var(--vscode-toolbar-hoverBackground)]"
    >
      {isExpanded ? (
        <ChevronDown className="w-3.5 h-3.5 mr-2 opacity-60" />
      ) : (
        <ChevronRight className="w-3.5 h-3.5 mr-2 opacity-60" />
      )}
      <span className="text-sm font-semibold mr-2">{view.name}</span>
      <span className="text-[11px] font-mono opacity-60 truncate">
        {relationship.source?.entity} &rarr; {relationship.destination?.entity}
      </span>
    </button>
    {isExpanded && (
      <div className="px-3 pb-3 space-y-3 border-t border-[var(--vscode-widget-border)]/60 pt-2">
        <div className="text-[11px]">
          <span className="opacity-60 mr-2">Backing table</span>
          <BigQueryTableLink id={view.backingTable} className="font-mono text-[var(--vscode-textLink-foreground)] hover:underline" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
          <div>
            <div className="opacity-60 font-sans mb-0.5">Source join</div>
            {(relationship.source?.relationshipColumns ?? []).map((column, index) => (
              <div key={column}>
                {column} <span className="opacity-50">&rarr;</span>{" "}
                {relationship.source?.entityColumns?.[index] ?? "?"}
              </div>
            ))}
          </div>
          <div>
            <div className="opacity-60 font-sans mb-0.5">Destination join</div>
            {(relationship.destination?.relationshipColumns ?? []).map((column, index) => (
              <div key={column}>
                {column} <span className="opacity-50">&rarr;</span>{" "}
                {relationship.destination?.entityColumns?.[index] ?? "?"}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="opacity-60 text-[11px] mb-1">Properties in query</div>
          <PropertyList element={view} selected={selected} onToggleProperty={onToggleProperty} />
        </div>
      </div>
    )}
  </div>
);

const PropertyGraphCard: React.FC<{ graph: PropertyGraph; state: WebviewState }> = ({ graph, state }) => {
  const graphKey = fullTargetName(graph.target);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [requestedSchemas, setRequestedSchemas] = useState<Record<string, boolean>>({});
  const [activeSpecIndex, setActiveSpecIndex] = useState(0);
  const [showBody, setShowBody] = useState(false);

  const specs = useMemo(() => buildGqlQuerySpecs(graph), [graph]);

  // Selection is seeded from compiled output only, so reading a backing table's schema
  // later never rewrites the query on its own — only a checkbox does.
  const [selection, setSelection] = useState<GqlSelection>(() => {
    const seeded: GqlSelection = {};
    (graph.entities ?? []).forEach((entity) => { seeded[entity.name] = knownPropertyNames(entity); });
    (graph.relationships ?? []).forEach((relationship) => {
      seeded[relationship.name] = knownPropertyNames(relationship);
    });
    return seeded;
  });

  const schemaKeyFor = useCallback((elementName: string) => `${graphKey}::${elementName}`, [graphKey]);

  const entityViews = useMemo(
    () => (graph.entities ?? []).map((entity) =>
      toElementView(entity, "entity", state.propertyGraphElementSchemas, requestedSchemas, schemaKeyFor(entity.name))),
    [graph.entities, state.propertyGraphElementSchemas, requestedSchemas, schemaKeyFor],
  );

  const relationshipViews = useMemo(
    () => (graph.relationships ?? []).map((relationship) =>
      toElementView(relationship, "relationship", state.propertyGraphElementSchemas, requestedSchemas, schemaKeyFor(relationship.name))),
    [graph.relationships, state.propertyGraphElementSchemas, requestedSchemas, schemaKeyFor],
  );

  const elementByName = useMemo(() => {
    const map = new Map<string, PropertyGraphEntity | PropertyGraphRelationship>();
    (graph.entities ?? []).forEach((entity) => map.set(entity.name, entity));
    (graph.relationships ?? []).forEach((relationship) => map.set(relationship.name, relationship));
    return map;
  }, [graph.entities, graph.relationships]);

  const handleToggleExpand = useCallback((elementName: string) => {
    const isOpening = expanded[elementName] !== true;
    setExpanded((previous) => ({ ...previous, [elementName]: isOpening }));

    if (!isOpening) {
      return;
    }

    // Only importAll elements need BigQuery: everything else already names all its properties.
    const element = elementByName.get(elementName);
    const schemaKey = schemaKeyFor(elementName);
    const needsSchema = element !== undefined
      && elementImportsAllColumns(element)
      && state.propertyGraphElementSchemas?.[schemaKey] === undefined
      && requestedSchemas[schemaKey] !== true;

    if (needsSchema) {
      setRequestedSchemas((current) => ({ ...current, [schemaKey]: true }));
      vscode.postMessage({
        command: "propertyGraphElementSchema",
        value: { elementName: schemaKey, target: element.dataSource },
      });
    }
  }, [expanded, elementByName, schemaKeyFor, requestedSchemas, state.propertyGraphElementSchemas]);

  const handleToggleProperty = useCallback((elementName: string, property: string) => {
    setSelection((previous) => {
      const current = previous[elementName] ?? [];
      return {
        ...previous,
        [elementName]: current.includes(property)
          ? current.filter((item) => item !== property)
          : [...current, property],
      };
    });
  }, []);

  const diagramEdges = useMemo(
    () => (graph.relationships ?? []).map((relationship, index) => ({
      relationship: relationshipViews[index],
      source: relationship.source?.entity ?? "",
      destination: relationship.destination?.entity ?? "",
    })),
    [graph.relationships, relationshipViews],
  );

  const activeSpec = specs[Math.min(activeSpecIndex, Math.max(specs.length - 1, 0))];
  const starterQuery = activeSpec ? buildGqlQuery(graph, activeSpec, selection) : "";
  const validation = state.propertyGraphValidations?.find((item) => item.targetName === graphKey);
  const bodyErrorAnnotations = validation?.graphBodyLine !== undefined && validation.message
    ? [{ line: validation.graphBodyLine, message: validation.message }]
    : undefined;

  return (
    <div className="space-y-4 rounded-xl border border-[var(--vscode-widget-border)]/60 bg-[var(--vscode-sideBar-background)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border border-[var(--vscode-charts-purple)] text-[var(--vscode-charts-purple)]">
          Property graph
        </span>
        <span className="text-sm font-semibold font-mono">{graph.target.name}</span>
        {graph.disabled && (
          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border border-[var(--vscode-widget-border)] opacity-70">
            disabled
          </span>
        )}
        <div className="flex-grow" />
        <button
          type="button"
          disabled={graph.disabled}
          onClick={() => vscode.postMessage({
            command: "runModel",
            value: { includeDependencies: false, includeDependents: false, fullRefresh: false },
          })}
          className="flex items-center px-3 py-1.5 text-xs bg-[var(--vscode-button-background)] hover:brightness-110 rounded text-[var(--vscode-button-foreground)] disabled:opacity-50"
        >
          <Play className="w-3 h-3 mr-1.5" /> Run graph
        </button>
      </div>

      <div className="text-[11px] font-mono text-[var(--vscode-descriptionForeground)]">{graphKey}</div>

      {graph.description && (
        <p className="text-xs text-[var(--vscode-foreground)] opacity-80 m-0">{graph.description}</p>
      )}

      {graph.tags?.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag className="w-3 h-3 opacity-50" />
          {graph.tags.map((tag) => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]">
              {tag}
            </span>
          ))}
        </div>
      )}

      <ValidationBanner validation={validation} dryRunning={state.dryRunning === true} />

      <PropertyGraphDiagram
        entities={entityViews}
        edges={diagramEdges}
        expanded={expanded}
        selection={selection}
        onToggleExpand={handleToggleExpand}
        onToggleProperty={handleToggleProperty}
      />
      <p className="text-[11px] text-[var(--vscode-descriptionForeground)] m-0">
        Click an entity to see its properties and choose which ones the starter query returns.
      </p>

      {relationshipViews.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold opacity-70">Relationships</div>
          {(graph.relationships ?? []).map((relationship, index) => (
            <RelationshipCard
              key={relationship.name}
              relationship={relationship}
              view={relationshipViews[index]}
              selected={selection[relationship.name] ?? []}
              isExpanded={expanded[relationship.name] === true}
              onToggleExpand={handleToggleExpand}
              onToggleProperty={handleToggleProperty}
            />
          ))}
        </div>
      )}

      {specs.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold opacity-70">Starter query</span>
            {specs.length > 1 && (
              <select
                value={activeSpecIndex}
                onChange={(event) => setActiveSpecIndex(Number(event.target.value))}
                className="text-xs bg-[var(--vscode-dropdown-background)] text-[var(--vscode-dropdown-foreground)] border border-[var(--vscode-dropdown-border)] rounded px-2 py-1"
              >
                {specs.map((spec, index) => (
                  <option key={spec.relationshipName} value={index}>
                    {spec.sourceEntityName} -[{spec.relationshipName}]&gt; {spec.destinationEntityName}
                  </option>
                ))}
              </select>
            )}
            <div className="flex-grow" />
            <button
              type="button"
              onClick={() => vscode.postMessage({
                command: "runGeneratedQuery",
                value: { query: starterQuery, type: "table" },
              })}
              className="flex items-center px-3 py-1.5 text-xs bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded text-[var(--vscode-button-secondaryForeground)]"
            >
              <Play className="w-3 h-3 mr-1.5" /> Run query
            </button>
          </div>
          <CodeBlock code={starterQuery} language="sql" />
          <p className="text-[11px] text-[var(--vscode-descriptionForeground)] m-0">
            GRAPH_TABLE reads the graph from BigQuery, so this needs the graph to have been
            created (Run graph) and a BigQuery Enterprise or Enterprise Plus reservation.
          </p>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowBody((open) => !open)}
          className="flex items-center text-xs font-semibold opacity-70 hover:opacity-100"
        >
          {showBody ? <ChevronDown className="w-3.5 h-3.5 mr-1.5" /> : <ChevronRight className="w-3.5 h-3.5 mr-1.5" />}
          Compiled graph body
        </button>
        {showBody && (
          <div className="mt-2">
            <p className="text-[11px] text-[var(--vscode-descriptionForeground)] mb-1">
              Emitted by @dataform/core exactly as shown. The statement Dataform wraps around it is
              not part of the compiled output — see the validation statement above.
            </p>
            <CodeBlock
              code={graph.graphBody ?? ""}
              language="sql"
              showLineNumbers
              errorAnnotations={bodyErrorAnnotations}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export const PropertyGraphSection: React.FC<{ state: WebviewState }> = ({ state }) => (
  <div className="space-y-4">
    {(state.propertyGraphs ?? []).map((graph) => (
      // Keying on the body as well as the target remounts the card when the graph is edited,
      // so the property selection is re-seeded from the new compiled output rather than
      // holding on to names the graph no longer exposes.
      <PropertyGraphCard
        key={`${fullTargetName(graph.target)}::${graph.graphBody ?? ""}`}
        graph={graph}
        state={state}
      />
    ))}
  </div>
);

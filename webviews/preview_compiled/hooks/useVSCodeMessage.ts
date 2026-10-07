import { useEffect, useState } from "react";
import { WebviewState } from "../types";
import { legacyStateReader } from "../../../src/shared/panelLegacyState";
import { PanelSlices, applyMessage, initialSlices } from "../../../src/shared/panelState";

declare global {
  interface Window {
    initialState?: Partial<WebviewState>;
  }
}

export const useVSCodeMessage = () => {
  const [state, setState] = useState<WebviewState>({ ...window.initialState, ...initialSlices(window.initialState) });

  useEffect(() => {
    // Some of the state arrives as slices of the panel contract; the components still read flat fields
    const toLegacyState = legacyStateReader();
    const handleMessage = (event: MessageEvent) => {
      const message: any = toLegacyState(event.data);
      setState((prevState) => {
        // The slices as they were sent, for the components that read them
        const { project, file, compile, bigquery, dataform, dbt } = prevState;
        const slices: PanelSlices = applyMessage({ project, file, compile, bigquery, dataform, dbt }, event.data, prevState.relativeFilePath);
        const nextState = {
          ...prevState,
          ...message,
          ...slices,
          compilationBackend:
            message.compilationBackend ??
            message.compilationInfo?.backend ??
            prevState.compilationBackend ??
            prevState.compilationInfo?.backend ??
            "cli",
          // Unless the host explicitly says recompiling/dryRunning: true, clear it
          recompiling:
            typeof message.recompiling === "boolean"
              ? message.recompiling
              : (prevState.recompiling ?? false),
          dryRunning:
            typeof message.dryRunning === "boolean"
              ? message.dryRunning
              : (prevState.dryRunning ?? false),
        };

        // Property graph state belongs to one file. A message announcing a different file
        // must not leave the previous file's graph on screen.
        if (message.relativeFilePath && message.relativeFilePath !== prevState.relativeFilePath) {
          nextState.propertyGraphs = message.propertyGraphs ?? null;
          nextState.propertyGraphValidations = message.propertyGraphValidations ?? null;
          nextState.deferral = message.deferral ?? null;
          nextState.leftoverProxies = message.leftoverProxies ?? null;
        }

        // Element schemas arrive one at a time as the user expands nodes, so they are merged
        // into the existing map rather than replacing it.
        if (message.propertyGraphElementSchema) {
          nextState.propertyGraphElementSchemas = {
            ...(prevState.propertyGraphElementSchemas ?? {}),
            [message.propertyGraphElementSchema.elementName]: message.propertyGraphElementSchema,
          };
          delete (nextState as Record<string, unknown>).propertyGraphElementSchema;
        }

        // When starting a new compilation or dry run, clear old errors and stats 
        // to prevent stale data from persisting until new results arrive.
        if (message.recompiling === true || message.dryRunning === true) {
          nextState.errorMessage = message.errorMessage || null;
          nextState.compilationErrors = message.compilationErrors || null;
          
          nextState.dryRunStatByNodeType = message.dryRunStatByNodeType || {};
          nextState.dryRunStatByNodeName = message.dryRunStatByNodeName || {};
          nextState.dryRunErrorsByNodeType = message.dryRunErrorsByNodeType || {};
          nextState.dryRunErrorsByNodeName = message.dryRunErrorsByNodeName || {};
          nextState.dryRunIncrementalErrorsByNodeName = message.dryRunIncrementalErrorsByNodeName || {};
          nextState.dryRunIncrementalErrorsByNodeType = message.dryRunIncrementalErrorsByNodeType || {};
          nextState.dryRunExpectedOutputErrorsByNodeName = message.dryRunExpectedOutputErrorsByNodeName || {};
          nextState.dryRunExpectedOutputErrorsByNodeType = message.dryRunExpectedOutputErrorsByNodeType || {};
          nextState.dataformCoreVersion = message.dataformCoreVersion;
          
          if (message.recompiling === true) {
            nextState.compilationTimeMs = undefined;
            nextState.modelsLastUpdateTimesMeta = [];
          }
        }

        return nextState;
      });
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  return state;
};

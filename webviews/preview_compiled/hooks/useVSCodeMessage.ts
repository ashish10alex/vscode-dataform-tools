import { useEffect, useState } from "react";
import { WebviewState } from "../types";

declare global {
  interface Window {
    initialState?: WebviewState;
  }
}

export const useVSCodeMessage = () => {
  const [state, setState] = useState<WebviewState>(window.initialState || {});

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      setState((prevState) => {
        const nextState = {
          ...prevState,
          ...message,
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

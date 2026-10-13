import { useEffect, useState } from "react";
import { PanelSlices, applyMessage, initialSlices } from "../../../src/shared/panelState";
import { vscode } from "../utils/vscode";

declare global {
  interface Window {
    /** The slices the host put in the panel's first page */
    initialState?: Partial<PanelSlices>;
  }
}

/** What the panel knows: the slices the host has sent, each kept as `applyMessage` says */
export const useVSCodeMessage = () => {
  const [state, setState] = useState<PanelSlices>(() => initialSlices(window.initialState));

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      setState((slices) => applyMessage(slices, event.data));
    };

    window.addEventListener("message", handleMessage);
    // Only now does anyone listen: the host sends again what it posted while the page was loading
    vscode.postMessage({ command: "ready" });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  return state;
};

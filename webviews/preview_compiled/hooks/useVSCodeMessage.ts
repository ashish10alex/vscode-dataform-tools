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
      setState((prevState) => ({ ...prevState, ...message }));
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  return state;
};

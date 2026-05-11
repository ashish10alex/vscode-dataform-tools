/**
 * Default values for VS Code's `--vscode-*` CSS variables, modeled on the
 * Dark+ theme. The webview's CSS references these tokens; inside the VS Code
 * webview the host injects real values, but in a plain browser they are
 * undefined and components render with no colors / transparent backgrounds.
 *
 * Defining them on `:root` here gives us readable defaults; if VS Code ever
 * starts serving this template it would override them at runtime.
 */
const vscodeThemeDefaults = `
:root {
  --vscode-editor-background: #1e1e1e;
  --vscode-foreground: #cccccc;
  --vscode-disabledForeground: #888888;
  --vscode-errorForeground: #f48771;
  --vscode-focusBorder: #007fd4;
  --vscode-widget-border: #303031;

  --vscode-input-background: #3c3c3c;
  --vscode-input-foreground: #cccccc;
  --vscode-input-border: #6c6c6c;
  --vscode-input-placeholderForeground: #a6a6a6;

  --vscode-dropdown-background: #3c3c3c;
  --vscode-dropdown-foreground: #f0f0f0;
  --vscode-dropdown-border: #6c6c6c;

  --vscode-button-background: #0e639c;
  --vscode-button-foreground: #ffffff;
  --vscode-button-hoverBackground: #1177bb;

  --vscode-list-activeSelectionBackground: #094771;
  --vscode-list-activeSelectionForeground: #ffffff;
  --vscode-list-hoverBackground: #2a2d2e;
  --vscode-list-hoverForeground: #cccccc;

  --vscode-sideBar-background: #252526;
  --vscode-sideBarSectionHeader-background: #2a2d2e;
  --vscode-toolbar-hoverBackground: #383b3d;

  --vscode-badge-background: #4d4d4d;
  --vscode-badge-foreground: #ffffff;
}

@media (prefers-color-scheme: light) {
  :root {
    --vscode-editor-background: #ffffff;
    --vscode-foreground: #1f1f1f;
    --vscode-disabledForeground: #767676;
    --vscode-errorForeground: #a1260d;
    --vscode-focusBorder: #0090f1;
    --vscode-widget-border: #d4d4d4;

    --vscode-input-background: #ffffff;
    --vscode-input-foreground: #1f1f1f;
    --vscode-input-border: #cecece;
    --vscode-input-placeholderForeground: #767676;

    --vscode-dropdown-background: #ffffff;
    --vscode-dropdown-foreground: #1f1f1f;
    --vscode-dropdown-border: #cecece;

    --vscode-button-background: #005fb8;
    --vscode-button-foreground: #ffffff;
    --vscode-button-hoverBackground: #0258a8;

    --vscode-list-activeSelectionBackground: #0060c0;
    --vscode-list-activeSelectionForeground: #ffffff;
    --vscode-list-hoverBackground: #f0f0f0;
    --vscode-list-hoverForeground: #1f1f1f;

    --vscode-sideBar-background: #f8f8f8;
    --vscode-sideBarSectionHeader-background: #ececec;
    --vscode-toolbar-hoverBackground: #e8e8e8;

    --vscode-badge-background: #cccccc;
    --vscode-badge-foreground: #1f1f1f;
  }
}
`;

export const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dataform Dependency Graph</title>
  <style>${vscodeThemeDefaults}
    html, body, #root { height: 100%; margin: 0; }
    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
  </style>
  <link href="/assets/StyledSelect.css" rel="stylesheet">
  <link href="/assets/dependancy_graph.css" rel="stylesheet">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/assets/dependancy_graph.js"></script>
</body>
</html>
`;

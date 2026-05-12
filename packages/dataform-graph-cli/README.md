# @ashishalex/dataform-graph

A CLI that serves the [vscode-dataform-tools](https://github.com/ashish10alex/vscode-dataform-tools) dependency graph in your browser. Wraps `dataform compile --json` and renders the same interactive React graph used by the VS Code extension — useful when you want to share the graph, view it without VS Code, or use a different editor.

## Install

```bash
npm install -g @ashishalex/dataform-graph
```

Or run on demand without installing:

```bash
npx @ashishalex/dataform-graph
```

## Requirements

- Node.js ≥ 18
- The [`dataform` CLI](https://www.npmjs.com/package/@dataform/cli) on your `PATH`, or pointed at via `--dataform-bin` / `$DATAFORM_BIN`
- For the **Show schema** button on each node: Google Cloud Application Default Credentials with permission to read the underlying BigQuery tables. Authenticate once with:
  ```bash
  gcloud auth application-default login
  ```
  Or point at a service-account key via `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`.

## Usage

Run from the root of a Dataform project (the directory containing `workflow_settings.yaml`):

```bash
dataform-graph
```

A local HTTP server starts on `127.0.0.1` and your default browser opens to it. Press `Ctrl+C` to stop.

### Options

```
-m, --model [model]    Filter the initial view to a specific model. Matches against
                       the file name, fully-qualified `database.schema.name`, or
                       short `target.name`. Pass --model with no value to pick
                       interactively (file → model).
-t, --tag [tag]        Filter the initial view to a specific tag. Pass --tag with
                       no value to pick a tag interactively.
-i, --input <path>     Use a pre-compiled dataform JSON file instead of running
                       `dataform compile --json`.
-c, --cwd <path>       Directory to run `dataform compile --json` from
                       (default: current directory).
    --dataform-bin <path>
                       Path or name of the dataform binary to invoke
                       (default: `dataform` on PATH, or $DATAFORM_BIN if set).
-p, --port <n>         Port to listen on (default: random ephemeral).
-H, --host <host>      Host interface to bind to (default: 127.0.0.1).
    --no-open          Do not auto-launch the default browser.
-h, --help             Show help.
```

`--model` and `--tag` are mutually exclusive.

### Examples

Open the graph for the model under your cursor… well, just pick interactively:

```bash
dataform-graph --model
```

Show only models tagged `daily`:

```bash
dataform-graph --tag daily
```

Use a project's local `dataform` instead of a global one:

```bash
dataform-graph --dataform-bin ./node_modules/.bin/dataform
```

Or set it once for the shell:

```bash
export DATAFORM_BIN=./node_modules/.bin/dataform
dataform-graph
```

Render from a pre-compiled JSON (skip running dataform):

```bash
dataform compile --json > compiled.json
dataform-graph --input compiled.json
```

### Interactive pickers

Both `--model` and `--tag` accept no value to launch a filterable picker. Keyboard navigation supports:

- `↑` / `↓` — arrow keys
- `Ctrl+N` / `Ctrl+P` — next / previous (emacs-style)
- `Ctrl+J` / `Ctrl+K` — next / previous (vim-style)
- type to filter
- `Enter` to select, `Ctrl+C` / `Esc` to cancel

## License

MIT

# Repository Agent Guidelines

## Commands and Workflows
- **Always use `just`**: This repository uses a `justfile` for common development and release tasks (type-checking, linting, packaging, and releases). Always check `justfile` before running ad-hoc shell commands.
- **Extension Releases**: To cut or publish a release (or pre-release) of the VS Code extension, invoke the `extension-release` skill. The release lifecycle is managed via `just` recipes (`just changes`, `just release`, `just push-release`, etc.).
- **Sub-packages**: Packages under `packages/*` (`npm-package`, `pypi-package`, `dataform-graph-cli`) are managed separately via Release Please on `main`.

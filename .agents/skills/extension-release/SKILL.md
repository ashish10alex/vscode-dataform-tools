---
name: extension-release
description: Release or pre-release the VS Code extension for Dataform tools to Visual Studio Marketplace and Open VSX using justfile recipes. Use when the user asks to release, pre-release, bump version, publish extension, or cut a release.
---

Release workflow for the VS Code extension (`dataform-lsp-vscode`). Monorepo sub-packages in `packages/*` are handled independently by Release Please on `main`.

## Channel & Version Conventions

VS Code marketplace extensions use minor version parity for release channels:
- **Odd minor** (e.g. `1.13.x`, `1.15.x`) = **pre-release**.
- **Even minor** (e.g. `1.12.x`, `1.14.x`) = **stable release**.

When asked to release:
1. Check current version: `just version`.
2. Determine bump target:
   - **Pre-release** requested:
     - If current minor is odd (e.g. `1.13.5`): patch bump (`1.13.6`).
     - If current minor is even (e.g. `1.12.13`): bump minor to the next odd minor (e.g. `1.13.0`).
   - **Stable release** requested:
     - If current minor is odd (e.g. `1.13.5`): bump minor to the next even minor (`1.14.0`).
     - If current minor is even (e.g. `1.14.2`): patch bump (`1.14.3`).

## Release Lifecycle

Releases are semi-autonomous: prepare and validate locally, stop for user confirmation, then push and monitor deployment.

### Phase 1: Local Verification & Bump
1. Verify working directory and upstream sync:
   ```bash
   just preflight
   ```
2. Inspect unreleased changes and preview version:
   ```bash
   just changes
   just preview <bump>
   ```
3. Run test and build checks:
   ```bash
   just check
   ```
4. Cut the release locally:
   ```bash
   just release <bump>
   ```
   This updates `package.json`, generates `CHANGELOG.md`, commits `chore(release): X.Y.Z`, and creates the local tag `vX.Y.Z`.

### Phase 2: User Approval Gate
**STOP HERE**. Do not push to remote origin without explicit user consent.
Show:
- The new version and channel (pre-release or stable).
- Summary of changes (`git show --stat HEAD`).
- Ask the user to confirm pushing and publishing to the marketplaces.

*(If the user requests changes or aborts: run `NON_INTERACTIVE=1 just undo-release` to cleanly drop the tag and reset the commit).*

### Phase 3: Publish & Watch Deploy
Once confirmed by the user, execute:
1. Push release commit and tag:
   ```bash
   NON_INTERACTIVE=1 just push-release
   ```
2. Follow GitHub Actions marketplace deploy:
   ```bash
   just watch-deploy
   ```
3. Create GitHub Release with auto-generated release notes:
   ```bash
   NON_INTERACTIVE=1 just github-release
   ```

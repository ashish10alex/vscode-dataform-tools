# Contributing to vscode-dataform-tools

This document outlines the contribution guidelines for the vscode-dataform-tools extension, using a simplified Git workflow.

## Git Workflow

We use a streamlined branching model:

* **`main` branch:** This branch always reflects the latest stable release.  Production releases are tagged from this branch.  Direct commits to `main` are generally discouraged except for hotfixes.
* **Feature branches:** Create a new branch for each feature or bug fix. Branch names should be descriptive (e.g., `feat/add-autocomplete`, `fix/resolve-error-123`).

### Workflow Steps:

1. **Create a new branch:**  Create a new branch from the `main` branch for your changes.

2. **Make changes:** Implement your changes, commit frequently with clear and concise messages. Adhere to the coding style guidelines (see below).

3. **Test thoroughly:** Ensure your changes work correctly and don't introduce regressions.

4. **Open a Pull Request:** Create a pull request on GitHub targeting the `main` branch.

    * **Clear title:**  Summarise your changes concisely.
    * **Detailed description:** Explain the changes, their purpose, and any relevant context. Include before-and-after screenshots or GIFs if appropriate.

5. **Address feedback:** Respond to any comments or suggested changes from reviewers.

6. **Merge (after approval):** Once the pull request is approved and all checks pass, merge it into the `main` branch.


## Pull Request Requirements

* **Clear, concise commit messages:**  Explain *what* you changed and *why*.
* **Code review:** At least one code review is required before merging.
* **Passing CI:** All continuous integration (CI) checks must pass before merging.
* **Adherence to coding style:** Your code must follow the style guide (see below).


## Versioning

We use Semantic Versioning (SemVer): `MAJOR.MINOR.PATCH`.

* **MAJOR:** For breaking changes.
* **MINOR:** For new features.
* **PATCH:** For bug fixes.

Update the `CHANGELOG.md` file with each pull request, following the format below.

## Changelog Format

```markdown
### [<MAJOR>.<MINOR>.<PATCH>](<LINK TO COMPARE>) (<DATE ADDED>)

### Features

* New feature description/s.

### Bug Fixes

* Bug fix description/s.
```

## Coding Style

We aim for consistency.  Generally follow standard JavaScript and TypeScript style guides.

* **TypeScript:** [TypeScript Style Guide](https://typescript-eslint.io/rules/) (or a similar widely adopted style guide).
* **JavaScript:** [Standard JavaScript Style Guide](https://standardjs.com/) or a similar widely adopted style guide.

## Issue Tracking

Please use GitHub Issues to report bugs and request features.  Before creating a new issue, search existing issues to avoid duplicates.

## License

[MIT License](LICENSE)

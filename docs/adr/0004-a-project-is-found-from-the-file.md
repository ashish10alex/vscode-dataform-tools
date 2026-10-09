---
status: accepted
---

# A Project is found from the file, by the nearest settings file above it

A Project was only ever at the root of a workspace folder. A dbt Project is very often a sub-folder of a larger repository, and so are some Dataform Projects, and each of these users got "open a folder that has the settings file at its root". Now the Project of a file is the nearest directory at or above it that has a settings file.

- **The directories above the file are looked at on each editor switch**, with no cache and no file watcher. That is about two `stat` calls per directory, which is the kind of work the extension already did per switch. A settings file created or deleted is noticed at the next switch. A watcher was not used for the reason given in `src/project/index.ts`: it made the git state be computed twice on some saves.
- **Never above the workspace folder.** A Project whose root is outside the window is not covered by search, the Explorer or file events. A folder opened too deep gets the message that the file is in no Project.
- **A settings file below `dbt_packages` or `node_modules` is passed over.** It is that of an installed package, and dbt compiles a package's files as part of the Project that installed it.
- **The workspace is searched once after activation**, in VS Code's search process, so that the Project picker and the commands know a Project before one of its files is opened. `node_modules`, `dbt_packages`, `target` and `.venv` are never searched, nor is what `files.exclude` and `search.exclude` turn off. The search adds Projects; it is never what decides the Project of a file.
- **Activation is by `workspaceContains:**/<settings file>`.** VS Code does that search itself. `onLanguage:sql` was rejected: it would start the extension in every repository with a SQL file.
- **API Compilation Mode needs the Project at the top of its git repository.** The Dataform API has no setting for a sub-directory. The check is on the git repository and not on the workspace folder, so a folder of several cloned repositories works. Otherwise the panel says why and offers CLI mode.
- **The message for a file in no Project names both Backends.** Nothing says which Backend a loose file was meant for.
- **A Project below a workspace folder keeps the settings of its own `.vscode/settings.json`.** VS Code reads that file only at the root of a workspace folder, so a Project opened from above lost its compiler options, repository name and the rest without a word. The extension reads the file itself, for its own settings only, and puts them before the window's, as a workspace folder's settings are. Every read of a setting goes through `extensionConfiguration` (`src/project/settings.ts`). Writes still go to VS Code's settings, with a warning when the Project's file sets the same setting; the extension does not edit a file VS Code does not own. Nothing is read in a window that is not trusted. The file is parsed by a few lines of the extension's own: `jsonc-parser` does not survive bundling by esbuild.

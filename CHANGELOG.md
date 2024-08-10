# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.0.33](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.32...v0.0.33) (2024-08-10)


### Features

* ability to specify the path to formatdataform cli. Helps to support windows executable `formatdataform.exe` and systems where sudo access might not be available ([d80d869](https://github.com/ashish10alex/vscode-dataform-tools/commit/d80d869faff97d1ff9c293356394ca0aba9c360d))
* share `CACHED_COMPILED_DATAFORM_JSON` across the ts files ([0e98813](https://github.com/ashish10alex/vscode-dataform-tools/commit/0e98813bd1abab41a9e4152feadaba0905f228e0))

### [0.0.32](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.31...v0.0.32) (2024-08-09)


### Bug Fixes

* do not activate on repos where there are no sqlx files ([5c6389f](https://github.com/ashish10alex/vscode-dataform-tools/commit/5c6389fd2c1ef4935cecb582b22edbee5c997bed))

### [0.0.31](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.30...v0.0.31) (2024-08-09)


### Features

* **autocompletion:** add support for `"${ref({schema:'dataset_name', name:'table_name'})}"` ([4eb8328](https://github.com/ashish10alex/vscode-dataform-tools/commit/4eb8328831c78971a12a8f91c2f0d26b4f072e57))
* Informative message to the user if current workspace is not a dataform workspace ([04517f6](https://github.com/ashish10alex/vscode-dataform-tools/commit/04517f6d934273f2c27151b3f2771ba00c15b746))


### Bug Fixes

* check for if the current workspace is dataform workspace ([14f29ab](https://github.com/ashish10alex/vscode-dataform-tools/commit/14f29abdf75904e7f8b9580f6d3d93e4f54e4036))

### [0.0.30](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.29...v0.0.30) (2024-08-09)


### Features

* add dataset legend in a navbar for cleaner feel ([9134bf5](https://github.com/ashish10alex/vscode-dataform-tools/commit/9134bf5f616cc3a3f4045a09ae4dcee2643755f7))
* Add FAQ section ([7a3adc4](https://github.com/ashish10alex/vscode-dataform-tools/commit/7a3adc4c2fdcee0503bafcb62815357ff98e71f8))
* **autocompletion:** Add user option to choose btw `${ref('table_name')}` or `${ref('dataset_name', 'table_name)}` ([ae446fa](https://github.com/ashish10alex/vscode-dataform-tools/commit/ae446fac0206d89f85ac1a2621240e458cb122ce))
* support filtering tree by `project.database.table` while keeping tree diplaying only table name ([888461e](https://github.com/ashish10alex/vscode-dataform-tools/commit/888461e2d6f9daacf3a5760b6fc4e074ca6eb046))

### [0.0.29](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.28...v0.0.29) (2024-08-06)


### Bug Fixes

* graph always defaulted to current file as root ([db69f8a](https://github.com/ashish10alex/vscode-dataform-tools/commit/db69f8ae2a21589cf6955f0c3f3b203b0cecc495))

### [0.0.28](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.27...v0.0.28) (2024-08-05)


### Features

* dependancy graph  ([#8](https://github.com/ashish10alex/vscode-dataform-tools/issues/8)) ([28776e4](https://github.com/ashish10alex/vscode-dataform-tools/commit/28776e4dbb7f2225b8d69ffbda58440ff81fc4c4))
* guide user to gihub page where formatdataform cli can be installed from ([1881be2](https://github.com/ashish10alex/vscode-dataform-tools/commit/1881be2f568deda4c29f5271547b8d9d8aa5dc4d))
* **hover:** show full table/view name of object referenced by `$ref{("my_source")}` ([6b34450](https://github.com/ashish10alex/vscode-dataform-tools/commit/6b3445044dc73c84f224bc7bdbe1315e2bfa3639))
* windows support ([b990b2c](https://github.com/ashish10alex/vscode-dataform-tools/commit/b990b2cc491668f11d452ff335b9f5b746c44d33))

### [0.0.27](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.26...v0.0.27) (2024-07-24)


### Features

* use canonicalTarget to navigate definitions ([8920b5f](https://github.com/ashish10alex/vscode-dataform-tools/commit/8920b5f3161c962abfb30be08e29743dfabd7ed0))


### Bug Fixes

* did not show metadata when there are no targets defined ([e8f082e](https://github.com/ashish10alex/vscode-dataform-tools/commit/e8f082e7000abf505336ca828d81b1bc2271acbc))

### [0.0.26](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.25...v0.0.26) (2024-07-16)


### Features

* **format:** show compiled query after formatting ([08d007a](https://github.com/ashish10alex/vscode-dataform-tools/commit/08d007a306364e40bb0e3bc0c9505cc3f4967f67))
* migrate to only use javascript and remove dependancy on dj cli ([#7](https://github.com/ashish10alex/vscode-dataform-tools/issues/7)) ([c00f6e6](https://github.com/ashish10alex/vscode-dataform-tools/commit/c00f6e6e151c4fc567b41af47c1c08ebbf74358d))

### [0.0.25](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.24...v0.0.25) (2024-07-04)


### Features

* add docs ([b21bf0c](https://github.com/ashish10alex/vscode-dataform-tools/commit/b21bf0c876aff8bd9024e3c065323baa8e07e1d9))

### [0.0.24](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.23...v0.0.24) (2024-07-04)


### Features

* Sqlfluff formating ([#6](https://github.com/ashish10alex/vscode-dataform-tools/issues/6)) ([6fd6a5d](https://github.com/ashish10alex/vscode-dataform-tools/commit/6fd6a5d9b44af440628ffd2e08e125b3eb3433e7))


### Bug Fixes

* diagnosics on wrong line when config block does not start at line 1 ([bcd932a](https://github.com/ashish10alex/vscode-dataform-tools/commit/bcd932a71e7a6693e485c1c5f404dace7daedba5))

### [0.0.23](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.22...v0.0.23) (2024-06-24)


### ⚠ BREAKING CHANGES

* dj cli now uses --file instead of --table to get cost
of running a file

### Features

* migrate to using dj v.0.07 ([6324298](https://github.com/ashish10alex/vscode-dataform-tools/commit/6324298dd9ecd2635340a5d684e323f5a078a8b0))

### [0.0.22](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.21...v0.0.22) (2024-06-23)


### Features

* code actions for diagnostic messages (alpha) ([#5](https://github.com/ashish10alex/vscode-dataform-tools/issues/5)) ([6c84386](https://github.com/ashish10alex/vscode-dataform-tools/commit/6c84386a743204dfb7d73deb829042749db8d1ed))
* show full table id (`project_id.database.table`) in notification on each successfull dry run ([288879d](https://github.com/ashish10alex/vscode-dataform-tools/commit/288879d9db37eb2c7312381aa509f9df99079227))
* user no longer needs to install golang to install the cli ([81dc624](https://github.com/ashish10alex/vscode-dataform-tools/commit/81dc62420a46959422abc9c30e6398c5d392b497))

### [0.0.21](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.20...v0.0.21) (2024-06-15)


### Features

* go to definition for source in `$ref{("MY_SOURCE")}` ([#4](https://github.com/ashish10alex/vscode-dataform-tools/issues/4)) ([0c0804a](https://github.com/ashish10alex/vscode-dataform-tools/commit/0c0804a9a97ddb4e70d80122e31717d0477fe21e))

### [0.0.20](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.19...v0.0.20) (2024-06-13)


### Features

* Ability to run file/tag with downstream dependents ([9bd140c](https://github.com/ashish10alex/vscode-dataform-tools/commit/9bd140cd9353aec8957e5bc45ec3796183af6ebd))


### Bug Fixes

* default to showing error on compiled query on saving as well ([678d10f](https://github.com/ashish10alex/vscode-dataform-tools/commit/678d10f0b6ccdd94afac7520b9f4d4862f6c23a9))

### [0.0.19](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.18...v0.0.19) (2024-06-12)

### [0.0.18](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.17...v0.0.18) (2024-06-12)

### Changes
* Update repository name from vscode-dataform-tools to vscode-dataform-tools to follow conventions

### [0.0.17](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.16...v0.0.17) (2024-06-12)


### Features

* ability to run a tag optionally with dependencies ([264ec59](https://github.com/ashish10alex/vscode-dataform-tools/commit/264ec59e28c183666c340069d7f81b4f49dc1074))
* **menu:** only display menu items when an `.sqlx` file is open ([c89ed94](https://github.com/ashish10alex/vscode-dataform-tools/commit/c89ed94dba8f7adee3e52c3d2b36490ed4ffe613))

### [0.0.16](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.15...v0.0.16) (2024-06-11)


### Bug Fixes

* ensure that diagnostic is actually set on the compiled query ([0a26386](https://github.com/ashish10alex/vscode-dataform-tools/commit/0a2638685b07b9f9764b56b5404c85f3c36eed4e))

### [0.0.15](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.14...v0.0.15) (2024-06-11)


### Features

* show diagnostics on the compiled query as well ([b5fa9fc](https://github.com/ashish10alex/vscode-dataform-tools/commit/b5fa9fcb439f5e1eeda89fd3aee524c386d09ff2))

### [0.0.14](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.13...v0.0.14) (2024-06-11)


### Bug Fixes

* sync being carried over to git hunks and other files ([2628da0](https://github.com/ashish10alex/vscode-dataform-tools/commit/2628da0b173b85cb33c58aa92940955b602cb0f1))
* unable to disable and enable plugin due to some commands being not disposed off ([4f338d8](https://github.com/ashish10alex/vscode-dataform-tools/commit/4f338d880f4208d591d5759ccc7881bd778c1de0))

### [0.0.13](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.12...v0.0.13) (2024-06-11)


### Features

* Add icon support for operations ([#3](https://github.com/ashish10alex/vscode-dataform-tools/issues/3)) ([7013a92](https://github.com/ashish10alex/vscode-dataform-tools/commit/7013a92ebba6258fd09e1e7422e60976df554d79))
* auto-save the document before compiling ([0bab56b](https://github.com/ashish10alex/vscode-dataform-tools/commit/0bab56bd75c04c861127ae170c11f0c93b1e54e0))


### Bug Fixes

* no need to open multiple terminal instances ([5715321](https://github.com/ashish10alex/vscode-dataform-tools/commit/5715321f8bf859aa9beeeb4e9a6aa54fab5d9d62))

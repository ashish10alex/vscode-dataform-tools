# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.6.3](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.6.2...v0.6.3) (2024-12-18)


### Features

* efficient loading of webview when invoked via icon ([c3332cf](https://github.com/ashish10alex/vscode-dataform-tools/commit/c3332cf4b4fac694411bc7e9c69926800f9642f9))
* retrieve location of table from dry run job ([7820525](https://github.com/ashish10alex/vscode-dataform-tools/commit/78205254ab7d500a77e3523c6f84c2cac9b40eff))


### Bug Fixes

* webview re-draws when same active editor is selected after clicking on webview ([c92a4d0](https://github.com/ashish10alex/vscode-dataform-tools/commit/c92a4d0ab26da0f4c7357ab8276d90c2297a79a1))

### [0.6.2](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.6.1...v0.6.2) (2024-12-18)


### Features

* tag external deps ([01adb7a](https://github.com/ashish10alex/vscode-dataform-tools/commit/01adb7ad7d877c45581166036f8b70bfbd103d8c))

### [0.6.1](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.6.0...v0.6.1) (2024-12-18)


### Features

* keep showing dry run stats which switching to schema tab ([d7be106](https://github.com/ashish10alex/vscode-dataform-tools/commit/d7be106cba9aa53928926d62a2a6037032d0d91a))
* load the web ui prior to compile to reduce perception of slowness ([d901e72](https://github.com/ashish10alex/vscode-dataform-tools/commit/d901e7243254a61ee614fa9ab72f37fd61fe67c2))
* show loading icon for dataplex lineage ([44dc8a2](https://github.com/ashish10alex/vscode-dataform-tools/commit/44dc8a26522fc0449b169ef8dd0da72efaee0098))
* use ordered list to easy identify no. of deps ([9172c5a](https://github.com/ashish10alex/vscode-dataform-tools/commit/9172c5ac0ae46cfbf26e075fbdb0d48a7e09c811))

## [0.6.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.5.14...v0.6.0) (2024-12-17)


### Features

* add `hasOutput` to operations snippets ([bbe520b](https://github.com/ashish10alex/vscode-dataform-tools/commit/bbe520b5b863b7fc39e8289c28bd9c9c1bb491c6))
* show external lineage of a table  ([#76](https://github.com/ashish10alex/vscode-dataform-tools/issues/76)) ([0859432](https://github.com/ashish10alex/vscode-dataform-tools/commit/0859432ca3e56780d73914eb20003a356b0f7538))

### [0.5.14](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.5.13...v0.5.14) (2024-12-11)


### Features

* optimize func to get dependents ([0f8a126](https://github.com/ashish10alex/vscode-dataform-tools/commit/0f8a1260a9c43a0a858127cd643de183f5685f41))

### [0.5.13](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.5.12...v0.5.13) (2024-12-11)


### Features

* reduce perceived latency of loading compiled query webview by showing progress ([df106fd](https://github.com/ashish10alex/vscode-dataform-tools/commit/df106fd444997f7858aba7c2a6fa90c807ef3b40))

### [0.5.12](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.5.11...v0.5.12) (2024-12-11)


### Bug Fixes

* error trying to get lenght of an obj that does not exists ([afd71db](https://github.com/ashish10alex/vscode-dataform-tools/commit/afd71db23d5397eb3d24d62a971f802a734cd1ec))

### [0.5.11](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.5.10...v0.5.11) (2024-12-11)


### Features

* show dependents of  model  in compiled query webview([#75](https://github.com/ashish10alex/vscode-dataform-tools/issues/75)) ([087beb6](https://github.com/ashish10alex/vscode-dataform-tools/commit/087beb6a8d09cb97088ea90d88a29f2947f79bd1))

### [0.5.10](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.5.9...v0.5.10) (2024-12-10)


### Features

* better nav bar for compiled query ([bfc1b22](https://github.com/ashish10alex/vscode-dataform-tools/commit/bfc1b22c6a1e0a3c8032588b51157f8ab04abb48))


### Bug Fixes

* formatted content goes to another file if active editor is switched quickly ([462e914](https://github.com/ashish10alex/vscode-dataform-tools/commit/462e91497f9d8ab76fb935cabd2c3be689bb49bb))

### [0.5.9](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.5.8...v0.5.9) (2024-12-04)


### Bug Fixes

* user has no notification when trying to run a file when dataform compiles throws error ([1fe0d06](https://github.com/ashish10alex/vscode-dataform-tools/commit/1fe0d066a7c0073a9a386e1913068c47f6bab6db))

### [0.5.8](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.5.7...v0.5.8) (2024-12-02)


### Features

* prettier hover documentation ([0c9df45](https://github.com/ashish10alex/vscode-dataform-tools/commit/0c9df4598f842665e9b359a5a15b41de5f45933e))


### Bug Fixes

* tabulator library error, invalid column definition option: `headerFilterLive` ([993c610](https://github.com/ashish10alex/vscode-dataform-tools/commit/993c610d0edd9af3aa6427e2293034b7d94b5bc9))

### [0.5.7](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.5.6...v0.5.7) (2024-11-29)


### Features

* trigger schema update on active editor change ([82db2bf](https://github.com/ashish10alex/vscode-dataform-tools/commit/82db2bf643a30b2ea852f926bb57e8d0c335638d))

### [0.5.6](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.5.5...v0.5.6) (2024-11-29)


### Features

* make the columns of the dependencies available for autocompletion ([#73](https://github.com/ashish10alex/vscode-dataform-tools/issues/73)) ([dd23704](https://github.com/ashish10alex/vscode-dataform-tools/commit/dd23704507e346f3a0a5e3d598cbc11766416d9e))

### [0.5.5](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.5.4...v0.5.5) (2024-11-28)


### Features

* show the change code action will apply ([9beabe4](https://github.com/ashish10alex/vscode-dataform-tools/commit/9beabe42521e3b7792f03c82201b18b15c507f1f))


### Bug Fixes

* debug not working with new build system ([4b91887](https://github.com/ashish10alex/vscode-dataform-tools/commit/4b918875f2a735122ac1f6cf76f14e585986de25))

### [0.5.4](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.5.3...v0.5.4) (2024-11-23)


### Features

* bundling extension using vscode ([#71](https://github.com/ashish10alex/vscode-dataform-tools/issues/71)) ([b6cf8c3](https://github.com/ashish10alex/vscode-dataform-tools/commit/b6cf8c32743e2fa9bfdf032985a8455a1659f2fb))

### [0.5.3](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.5.2...v0.5.3) (2024-11-19)


### Bug Fixes

* BigQuery client created in a non Dataform workspace ([#69](https://github.com/ashish10alex/vscode-dataform-tools/issues/69)) ([43dffbb](https://github.com/ashish10alex/vscode-dataform-tools/commit/43dffbb090dbd92c21a60b165fd54175fc5da19e))

### [0.5.2](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.5.1...v0.5.2) (2024-11-19)


### Features

* link to go to bigquery job from results preview ([#62](https://github.com/ashish10alex/vscode-dataform-tools/issues/62)) ([d629332](https://github.com/ashish10alex/vscode-dataform-tools/commit/d6293323a2d70edead0b7609dbbe9ef3e331f325))


### Bug Fixes

* pre_operations excluded on incremental previews ([01051c2](https://github.com/ashish10alex/vscode-dataform-tools/commit/01051c2d134be9703ca8b85c8a58a6c846c8a298))

### [0.5.1](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.5.0...v0.5.1) (2024-11-18)


### Bug Fixes

* **hover:** hover not showing if there is no declarations in the project ([7ec84b2](https://github.com/ashish10alex/vscode-dataform-tools/commit/7ec84b2d730446016349ae347c9b1e4f0b34e1fa))

## [0.5.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.4.0...v0.5.0) (2024-11-18)


### Features

* **hover:** show js variable / function definition on hover  ([#58](https://github.com/ashish10alex/vscode-dataform-tools/issues/58)) ([73d69e7](https://github.com/ashish10alex/vscode-dataform-tools/commit/73d69e7b90acb145e0139acb2ccfd3c0f4ccc42f))
* Improved BigQuery snippets ([#61](https://github.com/ashish10alex/vscode-dataform-tools/issues/61)) ([bdc0bfb](https://github.com/ashish10alex/vscode-dataform-tools/commit/bdc0bfb36d01cf376016ca5159ae33abc5dc8cb6))
* re-created authentication handler for BigQuery ([#60](https://github.com/ashish10alex/vscode-dataform-tools/issues/60)) ([94942a9](https://github.com/ashish10alex/vscode-dataform-tools/commit/94942a906777c376c620bca9cd46cceb8c3a47be))


### Bug Fixes

* array type throwing error on preview results ([797029d](https://github.com/ashish10alex/vscode-dataform-tools/commit/797029d2aa31f23896d15f0872808a1e4cba9406))
* **hover:** hover not showing if there is no declarations in the project ([c44767e](https://github.com/ashish10alex/vscode-dataform-tools/commit/c44767efe203852e2523cbf4fbb2280230b01707))

## [0.4.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.3.2...v0.4.0) (2024-11-16)


### Features

* add go to definition for js variables / modules from .sqlx files ([#51](https://github.com/ashish10alex/vscode-dataform-tools/issues/51)) ([027ee7f](https://github.com/ashish10alex/vscode-dataform-tools/commit/027ee7f04a91d9a6e75d825e50a96e68ed582df6))
* show user notification when extension is updated ([#56](https://github.com/ashish10alex/vscode-dataform-tools/issues/56)) ([7a63134](https://github.com/ashish10alex/vscode-dataform-tools/commit/7a6313402c64524f45afb6e91d3fb477cd0e9230))

### [0.3.2](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.3.1...v0.3.2) (2024-11-12)


### Features

* custom dark theme for tables ([489cd5f](https://github.com/ashish10alex/vscode-dataform-tools/commit/489cd5f94222d280cfb1ad0c4cb08cb663208a7b))
* make `preview results` table searchable ([33213e3](https://github.com/ashish10alex/vscode-dataform-tools/commit/33213e3d654f0d0a14fbd9208b63f680adb2b130))
* make schema table searchable ([57b512a](https://github.com/ashish10alex/vscode-dataform-tools/commit/57b512a91b4f5ff54feb3a9c1712e5f7978d8de9))

### [0.3.1](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.29...v0.3.1) (2024-11-12)


### Features

* faster and improved compilation webview ([#48](https://github.com/ashish10alex/vscode-dataform-tools/issues/48)) ([abff2e6](https://github.com/ashish10alex/vscode-dataform-tools/commit/abff2e6d412813d28daf9a59ff412179ce5f1bb7))

### [0.2.29](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.28...v0.2.29) (2024-11-11)


### Features

* definition provider with support for require and resolve  ([#46](https://github.com/ashish10alex/vscode-dataform-tools/issues/46)) ([63765ee](https://github.com/ashish10alex/vscode-dataform-tools/commit/63765eeda7af48f1abade60394c64429adea8b81))
* extended language support for bigquery functions ([#47](https://github.com/ashish10alex/vscode-dataform-tools/issues/47)) ([c6d7b8d](https://github.com/ashish10alex/vscode-dataform-tools/commit/c6d7b8d3f0a988a5ce81cf3f0674c8fea6c19d26))
* show dependencies in compilation web view ([#50](https://github.com/ashish10alex/vscode-dataform-tools/issues/50)) ([35bba42](https://github.com/ashish10alex/vscode-dataform-tools/commit/35bba42b54b406d34b8c6c16ece6e643f9d479e0))

### [0.2.28](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.27...v0.2.28) (2024-11-10)


### ⚠ BREAKING CHANGES

* Deprecates the ability to toogle useWebViewToShowCompiledQuery which used to enable the user to see the compiled query as an sql file in vertical split instead of using the web view (current default)

### Features

* deprecate option to show compiled query in a temporary sql fle ([#45](https://github.com/ashish10alex/vscode-dataform-tools/issues/45)) ([75a7442](https://github.com/ashish10alex/vscode-dataform-tools/commit/75a7442ff534e1b0a35fb56d584c87b88106c7c2))

### [0.2.27](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.26...v0.2.27) (2024-11-10)


### Features

* add loading icon when query is compiling ([7af31d8](https://github.com/ashish10alex/vscode-dataform-tools/commit/7af31d844c89ed34b4212e45461eaa76f05cb7be))
* additional table information on hover  ([#44](https://github.com/ashish10alex/vscode-dataform-tools/issues/44)) ([eefe4f7](https://github.com/ashish10alex/vscode-dataform-tools/commit/eefe4f7a8b1b9b97eb268a102e039453c5e8d519))

### [0.2.26](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.25...v0.2.26) (2024-11-08)


### Features

* toogle for incremental/non-incremental query execution ([#43](https://github.com/ashish10alex/vscode-dataform-tools/issues/43)) ([6b10a9f](https://github.com/ashish10alex/vscode-dataform-tools/commit/6b10a9f2244cd9ff7214f83123d9ced63d09adbb))

### [0.2.25](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.24...v0.2.25) (2024-11-08)


### Features

* show link to target model in compilation webview ([bf789af](https://github.com/ashish10alex/vscode-dataform-tools/commit/bf789af0c17f3121f46fc0ba4bc0e3cdd3e45245))

### [0.2.24](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.23...v0.2.24) (2024-11-08)


### Bug Fixes

* **preview:** duplication of rows when array has multiple objects ([820bc4e](https://github.com/ashish10alex/vscode-dataform-tools/commit/820bc4e26c8aa7649f97de18073af0e29b0e80f5))

### [0.2.23](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.22...v0.2.23) (2024-11-08)


### Bug Fixes

* **preview:** mix of empty and filled array in a column gives error ([babbcda](https://github.com/ashish10alex/vscode-dataform-tools/commit/babbcda91d8ce9027d31ff61384884dbaf6f18db))

### [0.2.22](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.21...v0.2.22) (2024-11-07)


### Bug Fixes

* table showing results preview missing columns and rows for non trivial data structures ([ae3e4ca](https://github.com/ashish10alex/vscode-dataform-tools/commit/ae3e4ca789d94af68997c7c4e00175630931b961))

### [0.2.21](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.20...v0.2.21) (2024-11-07)


### Features

* show schema along with compiled query ([8a21700](https://github.com/ashish10alex/vscode-dataform-tools/commit/8a21700127d16c2764b17f66baf3233653e3ed77))

### [0.2.20](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.19...v0.2.20) (2024-11-06)


### Features

* bigquery snippets from https://github.com/shinichi-takii/vscode-language-sql-bigquery ([ced4648](https://github.com/ashish10alex/vscode-dataform-tools/commit/ced46486867f2cf8d23c490248c670b7b58c36df))

### [0.2.19](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.18...v0.2.19) (2024-11-05)


### Features

* support for formatting js blocks in sqlx file. fixes: https://github.com/ashish10alex/vscode-dataform-tools/issues/38 ([161e07f](https://github.com/ashish10alex/vscode-dataform-tools/commit/161e07f349d8ea44d9cf98e9872f6b3244def5fd))

### [0.2.18](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.17...v0.2.18) (2024-10-30)


### Features

* improved ui for dependancy graph ([5ac3ff2](https://github.com/ashish10alex/vscode-dataform-tools/commit/5ac3ff2dd44a70e313cb6ba1058be467aaca07fc))

### [0.2.17](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.16...v0.2.17) (2024-10-28)


### Bug Fixes

* if tag is named all it will not be filtered correctly ([cdc8d7a](https://github.com/ashish10alex/vscode-dataform-tools/commit/cdc8d7a75a877b002bec39944fd967321b283045))

### [0.2.16](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.15...v0.2.16) (2024-10-28)


### Features

* expand and collapse tree using button ([0fa9b13](https://github.com/ashish10alex/vscode-dataform-tools/commit/0fa9b13b5f10a6c5961380e62d23110a8300d308))

### [0.2.15](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.14...v0.2.15) (2024-10-26)


### Features

* command to show side panel ([6e02c6b](https://github.com/ashish10alex/vscode-dataform-tools/commit/6e02c6bc87def4c1e3f6c555ac40b7baceb4a6ad))

### [0.2.14](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.13...v0.2.14) (2024-10-25)


### Features

* add option to filter tags in dependency graph. solves: https://github.com/ashish10alex/vscode-dataform-tools/issues/36 ([cd269d2](https://github.com/ashish10alex/vscode-dataform-tools/commit/cd269d2de484eff875f6d8d10b4da22c76c70301))
* show indicator on what dropdown options are ([3812bc0](https://github.com/ashish10alex/vscode-dataform-tools/commit/3812bc0502ed401305bb57b008b976f61d94552c))

### [0.2.13](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.12...v0.2.13) (2024-10-22)


### Bug Fixes

* copied code block does not update unless compiled query window is closed ([5788276](https://github.com/ashish10alex/vscode-dataform-tools/commit/5788276670d35f27718c4080fb584bf057b85f9b))

### [0.2.12](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.11...v0.2.12) (2024-10-21)

### [0.2.11](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.10...v0.2.11) (2024-10-20)


### Features

* improve setup of new Dataform workspace ([5cb0fd3](https://github.com/ashish10alex/vscode-dataform-tools/commit/5cb0fd3401100040e545df0f2e4d25bcc5b60dbb))

### [0.2.10](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.9...v0.2.10) (2024-10-15)


### Bug Fixes

* empty error div showing even if there no error ([095a5b7](https://github.com/ashish10alex/vscode-dataform-tools/commit/095a5b7d7cab655d7ff094e690c6fb4a1d861e23))
* whitespace of non zero length causing incorrect diagnostics placement ([f071763](https://github.com/ashish10alex/vscode-dataform-tools/commit/f071763bfee143324f1bb26cf0f0ba7918f50eae))

### [0.2.9](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.8...v0.2.9) (2024-10-13)


### Features

* show assertion failed message if the ran query was an assertion ([c454289](https://github.com/ashish10alex/vscode-dataform-tools/commit/c454289a78ceac6ac12cecb61417a95fd5b13e44))

### [0.2.8](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.7...v0.2.8) (2024-10-13)


### Features

* show assertion passed in webview when assertion is ran & passes ([9398d90](https://github.com/ashish10alex/vscode-dataform-tools/commit/9398d904a2a3ffe3e0d4f2209596a6851b686d54))


### Bug Fixes

* error when using line number plugin (highlight.js) on undefined div elements ([ab1b4a7](https://github.com/ashish10alex/vscode-dataform-tools/commit/ab1b4a7c2c9c3443b01475f01562c1224247cf6c))

### [0.2.7](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.6...v0.2.7) (2024-10-13)


### Features

* improve default compiled query web view load time by removing redundant query computation ([dbe413c](https://github.com/ashish10alex/vscode-dataform-tools/commit/dbe413c933a1c67e1e132b1ed8530065945d5040))

### [0.2.6](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.5...v0.2.6) (2024-10-11)


### Features

* ability to specify additional args, solves https://github.com/ashish10alex/vscode-dataform-tools/issues/31 ([66b6322](https://github.com/ashish10alex/vscode-dataform-tools/commit/66b6322121b164c55ee4f4ea15bba7274443c597))

### [0.2.5](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.4...v0.2.5) (2024-10-08)


### Bug Fixes

* flicker on reload ([4794c33](https://github.com/ashish10alex/vscode-dataform-tools/commit/4794c337144e6dd4a37679d930fa1ba9ffc95abd))

### [0.2.4](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.3...v0.2.4) (2024-10-08)

### [0.2.3](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.2...v0.2.3) (2024-10-08)


### Features

* check for gcloud cli on installation ([01c2e6c](https://github.com/ashish10alex/vscode-dataform-tools/commit/01c2e6c0b8d6e6f5dcf3534772b2db9aa26bbe38))

### [0.2.2](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.1...v0.2.2) (2024-10-08)


### Bug Fixes

* incremental pre_operations having extra semi colon ([7a74235](https://github.com/ashish10alex/vscode-dataform-tools/commit/7a7423582e175176e646155448f46e8494787a7a))

### [0.2.1](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.2.0...v0.2.1) (2024-10-08)


### Bug Fixes

* compiled query in web view not showing when menu button is clicked ([e01b89c](https://github.com/ashish10alex/vscode-dataform-tools/commit/e01b89cb2517e9ee8c22c4eb4c9c836b04ddec5d))

## [0.2.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.1.2...v0.2.0) (2024-10-07)


### Features

* Navbar to show compiled query in results preview webview ([#29](https://github.com/ashish10alex/vscode-dataform-tools/issues/29)) ([eda9398](https://github.com/ashish10alex/vscode-dataform-tools/commit/eda9398e8b8a0be79f8c6a7e5a46c3e1dcbf1458))

### [0.1.2](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.1.1...v0.1.2) (2024-10-03)


### Features

* deprecate enable/disable commands and stop creating disposable object ([01cff72](https://github.com/ashish10alex/vscode-dataform-tools/commit/01cff72ce0bad8ed69be37c84458956ff279a772))
* deprecate menu to run file with deps ([3cb9ebe](https://github.com/ashish10alex/vscode-dataform-tools/commit/3cb9ebe99b9a1bed01a9f17e304fd841b3acd289))


### Bug Fixes

* query compilation error when pre/post ops have semicolon ([8fff62e](https://github.com/ashish10alex/vscode-dataform-tools/commit/8fff62e70aec63fd2b12fd2b87a0f7000165df0b))

### [0.1.1](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.1.0...v0.1.1) (2024-09-30)


### Features

* explicitly add limit to only preview query results ([af83c83](https://github.com/ashish10alex/vscode-dataform-tools/commit/af83c83d8038f531246de36bf7fd04dd750150e3))

## [0.1.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.61...v0.1.0) (2024-09-27)


### Features

* show query results in table ([#23](https://github.com/ashish10alex/vscode-dataform-tools/issues/23)) ([a02224c](https://github.com/ashish10alex/vscode-dataform-tools/commit/a02224cc557f4e22ddd1dc6d18d16770e53a3804))

### [0.0.61](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.60...v0.0.61) (2024-09-24)


### Bug Fixes

* running tags command missing --tags ([b45c2a1](https://github.com/ashish10alex/vscode-dataform-tools/commit/b45c2a1ce0d7815343caff6f1fabc4ff76a5f39b))

### [0.0.60](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.59...v0.0.60) (2024-09-24)


### Bug Fixes

* when running a single tag it does not pick up options ([1d3b805](https://github.com/ashish10alex/vscode-dataform-tools/commit/1d3b80536743189af6edcbeeff7a5c7f3bd8bfc3))

### [0.0.59](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.58...v0.0.59) (2024-09-22)


### Bug Fixes

* assertions not showing in the compiled query ([ece9340](https://github.com/ashish10alex/vscode-dataform-tools/commit/ece9340d2f06d5421c96a20848b33b56dc8d7932))

### [0.0.58](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.57...v0.0.58) (2024-09-22)


### Features

* snippets for view and operations ([a3730ef](https://github.com/ashish10alex/vscode-dataform-tools/commit/a3730efe75b2bd1596ea35ea3a1d9279151201f9))

### [0.0.57](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.56...v0.0.57) (2024-09-22)


### Features

* Ability to choose more options when running file(s) / tag(s) ([#26](https://github.com/ashish10alex/vscode-dataform-tools/issues/26)) ([3729b8b](https://github.com/ashish10alex/vscode-dataform-tools/commit/3729b8bf18c0624fb4ac8e6b8ccc237b41d16287))

### [0.0.56](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.55...v0.0.56) (2024-09-20)


### Bug Fixes

* path issue with sqlx files of type operations ([42b330c](https://github.com/ashish10alex/vscode-dataform-tools/commit/42b330cc7ed7605931b6af07940cd769c9bead1f))

### [0.0.55](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.54...v0.0.55) (2024-09-20)


### Bug Fixes

* dry run stats not showing for js files ([f8f9595](https://github.com/ashish10alex/vscode-dataform-tools/commit/f8f95954f021d66325ae08e80727d1b73c0cafbc))
* relative file path issue on windows ([48563de](https://github.com/ashish10alex/vscode-dataform-tools/commit/48563de33294b9d3d6333abefd8d6d194288b8ce))

### [0.0.54](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.53...v0.0.54) (2024-09-19)


### Bug Fixes

* sidepanel not showing metadata ([1f2b524](https://github.com/ashish10alex/vscode-dataform-tools/commit/1f2b5245307769832dc61b47afef549f54829116))

### [0.0.53](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.52...v0.0.53) (2024-09-19)


### Bug Fixes

* formatting complains about filetype ([8a05669](https://github.com/ashish10alex/vscode-dataform-tools/commit/8a05669f2e487df36031a07037ec6d465543e45d))

### [0.0.52](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.51...v0.0.52) (2024-09-18)


### Bug Fixes

* https://github.com/ashish10alex/vscode-dataform-tools/issues/25 ([26b6d44](https://github.com/ashish10alex/vscode-dataform-tools/commit/26b6d442f9e8088a6f01cfccdfe42e7812ee558d))

### [0.0.51](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.50...v0.0.51) (2024-09-18)


### Features

* add language config to improve basic editing experience ([76aaab4](https://github.com/ashish10alex/vscode-dataform-tools/commit/76aaab4dd65beaed538e62c2d5fa4fcb4559d262))

### [0.0.50](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.49...v0.0.50) (2024-09-11)


### Features

* Go to code by clicking on text objects of dependancy graph ([#17](https://github.com/ashish10alex/vscode-dataform-tools/issues/17)) ([0808cae](https://github.com/ashish10alex/vscode-dataform-tools/commit/0808cae52b50703ede3dd8f23359ab81e6573daa))

### [0.0.49](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.48...v0.0.49) (2024-09-05)


### Features

* Ability to execute multiple files ([b7bb14a](https://github.com/ashish10alex/vscode-dataform-tools/commit/b7bb14a9858b2e574e904b42ccc64b92286b5716))

### [0.0.48](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.47...v0.0.48) (2024-08-30)


### Features

* format config block using js-beautify ([2d5897b](https://github.com/ashish10alex/vscode-dataform-tools/commit/2d5897b473d4d595d948ee58091ac10b8fc1c863))

### [0.0.47](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.46...v0.0.47) (2024-08-29)


### Bug Fixes

* config block exists property not marked as true when it is single line ([a41bc8a](https://github.com/ashish10alex/vscode-dataform-tools/commit/a41bc8a0e90bdb9d0b03f367c6716cf2527e47ae))

### [0.0.46](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.45...v0.0.46) (2024-08-29)


### Bug Fixes

* sqlx parser did not support when multiple curley braces in single line in config/pre/post ops block ([884c74e](https://github.com/ashish10alex/vscode-dataform-tools/commit/884c74eb82d316d424e2529f9fc2cf6b9f9bc068))

### [0.0.45](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.44...v0.0.45) (2024-08-26)


### Features

* add sqlfluff file to support multi line ref & single line pre/post ops ([277fda9](https://github.com/ashish10alex/vscode-dataform-tools/commit/277fda98ebc3d82fe4606c7ad8d93655d5ca90dc))

### [0.0.44](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.43...v0.0.44) (2024-08-26)


### Bug Fixes

* Multiline ref block not getting formatted & single line pre/post ops block ([#18](https://github.com/ashish10alex/vscode-dataform-tools/issues/18)) ([208f9cc](https://github.com/ashish10alex/vscode-dataform-tools/commit/208f9ccd767f64f88753e3da4f11d3583df92fad))

### [0.0.43](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.42...v0.0.43) (2024-08-21)


### Features

* native syntax highlighting for sqlx ([#16](https://github.com/ashish10alex/vscode-dataform-tools/issues/16)) ([88338b9](https://github.com/ashish10alex/vscode-dataform-tools/commit/88338b93f0f64b3fce2a45e2c8f8fd92010b5c57))

### [0.0.42](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.40...v0.0.42) (2024-08-21)


### Features

* update sqlfluff config file to support `${ref({schema:'dataset_name', name:'table_name'})}` ([15bb443](https://github.com/ashish10alex/vscode-dataform-tools/commit/15bb443521e2ccf362f953a724d489e74688559c))


### Bug Fixes

* check should be for sqlfluff cli ([ed44477](https://github.com/ashish10alex/vscode-dataform-tools/commit/ed444774ecbaaa6cc8571340d5d7d6e651e31772))

### [0.0.40](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.39...v0.0.40) (2024-08-20)


### Bug Fixes

* unable to parse sqlx end line when single line sql block is present ([0a7d241](https://github.com/ashish10alex/vscode-dataform-tools/commit/0a7d2417a3b8d4340f042901195683a154f1a432))

### [0.0.39](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.38...v0.0.39) (2024-08-20)


### Features

* add snippets for pre and post operation blocks ([2b0743b](https://github.com/ashish10alex/vscode-dataform-tools/commit/2b0743b253914772d3462a98f914c1c5f68f9bac))

### [0.0.38](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.37...v0.0.38) (2024-08-14)


### Bug Fixes

* compilation timeout when running a file / tag  ([#13](https://github.com/ashish10alex/vscode-dataform-tools/issues/13)) ([37a2aa4](https://github.com/ashish10alex/vscode-dataform-tools/commit/37a2aa411a8defd6b843b308d93b1998089daf6b))

### [0.0.37](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.36...v0.0.37) (2024-08-13)


### Bug Fixes

* compilation timeout https://github.com/ashish10alex/vscode-dataform-tools/issues/10 ([#11](https://github.com/ashish10alex/vscode-dataform-tools/issues/11)) ([655ab4e](https://github.com/ashish10alex/vscode-dataform-tools/commit/655ab4e288a8bc3f1df887c6868c13f1cd055e23))

### [0.0.36](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.35...v0.0.36) (2024-08-12)


### Features

* cache compiled json during activation of the extension if available ([1179509](https://github.com/ashish10alex/vscode-dataform-tools/commit/1179509328a8d21c4d320fbf395e180b73ffc76b))


### Bug Fixes

* incremental tables & failing operations when undefined ([4857eb9](https://github.com/ashish10alex/vscode-dataform-tools/commit/4857eb9b43e4938747410f0dacfacdbba561e7f8))

### [0.0.35](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.34...v0.0.35) (2024-08-10)


### Bug Fixes

* on initial extension activation if extension path is specified donot verify that with `where` / `which` command as we have already checked the filepath before ([c4f1db9](https://github.com/ashish10alex/vscode-dataform-tools/commit/c4f1db94631d2a9b2956493aa466591c9ab0adf6))

### [0.0.34](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.0.33...v0.0.34) (2024-08-10)


### Bug Fixes

* for windows if path to executable is specified `where.exe` is not able to verify that ([f6f77d7](https://github.com/ashish10alex/vscode-dataform-tools/commit/f6f77d7a46542b1295f6bec65187297261d3c93d))

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

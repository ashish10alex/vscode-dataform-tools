# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.17.6](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.17.5...v0.17.6) (2025-11-12)


### Features

* add an icon for .sqlx file ([382d8a9](https://github.com/ashish10alex/vscode-dataform-tools/commit/382d8a9c701154c128db261cd60841aa42c7a9c8))
* **npm:** npm package for @google-cloud/dataform ([#206](https://github.com/ashish10alex/vscode-dataform-tools/issues/206)) ([a760907](https://github.com/ashish10alex/vscode-dataform-tools/commit/a760907fe230f7cf03ed517534749d3cce9ae4b7))


### Bug Fixes

* **webview:** dist folder not getting created by prepublish in ci ([#209](https://github.com/ashish10alex/vscode-dataform-tools/issues/209)) ([68eda8f](https://github.com/ashish10alex/vscode-dataform-tools/commit/68eda8faaba8772a377b56ee18b4c42a4b4e9c33))

### [0.17.5](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.17.4...v0.17.5) (2025-11-04)


### Features

* improve sqlx parser, faster by approx 2x ([#203](https://github.com/ashish10alex/vscode-dataform-tools/issues/203)) ([dd400e3](https://github.com/ashish10alex/vscode-dataform-tools/commit/dd400e30d5c4e1b82d81fedc95f660f44d62d003))


### Bug Fixes

* yaml and json files not being synced to remote workspace ([#202](https://github.com/ashish10alex/vscode-dataform-tools/issues/202)) ([e91178e](https://github.com/ashish10alex/vscode-dataform-tools/commit/e91178e30078cf6a47d89e276be3d890d02ab5d9))

### [0.17.4](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.17.3...v0.17.4) (2025-11-03)


### Features

* use ci to publish extension in Microsoft marketplace and open vsx ([#201](https://github.com/ashish10alex/vscode-dataform-tools/issues/201)) ([b2a8b5a](https://github.com/ashish10alex/vscode-dataform-tools/commit/b2a8b5aa30b3b552c0bfe9afa2cffc9e9ecb4b00))


### Bug Fixes

* git repo name not correctly picked up when using git worktrees ([dd4ade6](https://github.com/ashish10alex/vscode-dataform-tools/commit/dd4ade6e2f236a124a9ea25f433898a7c488f810))

### [0.17.3](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.17.2...v0.17.3) (2025-11-01)


### Bug Fixes

* pre operations not getting correctly assigned to model type `incremental` ([#200](https://github.com/ashish10alex/vscode-dataform-tools/issues/200)) ([ea96f4f](https://github.com/ashish10alex/vscode-dataform-tools/commit/ea96f4f0475d2fdc9431fc63c1dd160a05aa022f))

### [0.17.2](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.17.1...v0.17.2) (2025-10-29)


### Bug Fixes

* **wsl:** ui getting blocked by awaiting user input to install error lens extension ([0c62c9d](https://github.com/ashish10alex/vscode-dataform-tools/commit/0c62c9d39cbfc4b80c9d6c03d73f2d57febb2f16))

### [0.17.1](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.17.0...v0.17.1) (2025-10-29)


### Bug Fixes

* compiler options not getting passed for execution via api ([08f9189](https://github.com/ashish10alex/vscode-dataform-tools/commit/08f9189dfd75209de4c0a920e6a0c7a87a529a9d))
* **webview:** link of model should be shown as soon as the compilation is done ([acec93c](https://github.com/ashish10alex/vscode-dataform-tools/commit/acec93c33f7976afc0b643706733c951002aa3dd))

## [0.17.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.16.9...v0.17.0) (2025-10-27)


### Features

* invoke Dataform run in managed Dataform workspace in GCP using api [beta] ([#198](https://github.com/ashish10alex/vscode-dataform-tools/issues/198)) ([1f3cd2d](https://github.com/ashish10alex/vscode-dataform-tools/commit/1f3cd2d06520ba868bd046278db8737ba50b7627))
* make compiled query web view more responsive when re-compilation is triggered ([#197](https://github.com/ashish10alex/vscode-dataform-tools/issues/197)) ([b9a9eaa](https://github.com/ashish10alex/vscode-dataform-tools/commit/b9a9eaaabe2ebd2dacf83c20b967746ec6ebc3e7))
* use api to run files & tags in managed Dataform instance ([#194](https://github.com/ashish10alex/vscode-dataform-tools/issues/194)) ([07ed05c](https://github.com/ashish10alex/vscode-dataform-tools/commit/07ed05c3efe9d038f3743802dab74e8bb9ade7d9))
* **website:** update landing page image to be reflective of the latest features ([9fd9d81](https://github.com/ashish10alex/vscode-dataform-tools/commit/9fd9d81635096c360bd3767adf4ac07a03b83336))

### [0.16.9](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.16.8...v0.16.9) (2025-10-10)


### Features

* add navigate to BigQuery & copy model name from dependancy graph ([#196](https://github.com/ashish10alex/vscode-dataform-tools/issues/196)) ([94746cc](https://github.com/ashish10alex/vscode-dataform-tools/commit/94746ccac21b446ea66466eef3128f6443c1ea41))


### Bug Fixes

* file extension not correctly inferred when multiple period symbols in filename ([#193](https://github.com/ashish10alex/vscode-dataform-tools/issues/193)) ([71b5a99](https://github.com/ashish10alex/vscode-dataform-tools/commit/71b5a99c3c6388bac49df8e1aa8d0e260afc0144))

### [0.16.8](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.16.7...v0.16.8) (2025-09-18)


### Features

* enable use of service account key to access bigquery ([#191](https://github.com/ashish10alex/vscode-dataform-tools/issues/191)) ([2d7748b](https://github.com/ashish10alex/vscode-dataform-tools/commit/2d7748bdee90463a3c0427290b0bf040ec2e4739))
* increase limit to 500k rows ([f7c1b3d](https://github.com/ashish10alex/vscode-dataform-tools/commit/f7c1b3d0a4911c2708b43cd9b3db9866ed01ee59))


### Styling

* shift download csv to right ([c7a04e4](https://github.com/ashish10alex/vscode-dataform-tools/commit/c7a04e41726f83b26eb20146ac6ddc0be894494f))

### [0.16.7](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.16.6...v0.16.7) (2025-09-10)


### Features

* export bigquery preview data as csv and show job id ([#189](https://github.com/ashish10alex/vscode-dataform-tools/issues/189)) ([4d15cb8](https://github.com/ashish10alex/vscode-dataform-tools/commit/4d15cb8f648cd2d779ee9e40312d6ec1d4abf29c))

### [0.16.6](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.16.5...v0.16.6) (2025-09-07)


### Features

* show model schema on hover over a ref ([#188](https://github.com/ashish10alex/vscode-dataform-tools/issues/188)) ([0a28130](https://github.com/ashish10alex/vscode-dataform-tools/commit/0a2813051890fef377c97d7c5971f422399484a5))

### [0.16.5](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.16.4...v0.16.5) (2025-09-04)


### Features

* navigate to dependencies and dependents  ([#186](https://github.com/ashish10alex/vscode-dataform-tools/issues/186)) ([9ef872b](https://github.com/ashish10alex/vscode-dataform-tools/commit/9ef872b8ed6293be3289cbc24fd8ac2451d9c23f))

### [0.16.4](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.16.3...v0.16.4) (2025-08-26)


### Bug Fixes

* prevent data preview table from overflowing ([#184](https://github.com/ashish10alex/vscode-dataform-tools/issues/184)) ([d45043a](https://github.com/ashish10alex/vscode-dataform-tools/commit/d45043a92877085ebc65cdba93bf6c7cf83d5728))

### [0.16.3](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.16.2...v0.16.3) (2025-08-14)


### Bug Fixes

* **windows:** running multiple files using multi select ([4a64c66](https://github.com/ashish10alex/vscode-dataform-tools/commit/4a64c666b42d1ac9665cb660ec89b92dfb719b88))

### [0.16.2](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.16.1...v0.16.2) (2025-08-13)


### Features

* command to create a new Dataform project ([#177](https://github.com/ashish10alex/vscode-dataform-tools/issues/177)) ([c5a6f60](https://github.com/ashish10alex/vscode-dataform-tools/commit/c5a6f603f98fd9f39bdae75c5582cfcbba20d73f))
* show hover description for columns of type record ([#178](https://github.com/ashish10alex/vscode-dataform-tools/issues/178)) ([8ed4eb7](https://github.com/ashish10alex/vscode-dataform-tools/commit/8ed4eb75edde82e1c4d0f8b1cc1b941748a47ac3))

### [0.16.1](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.16.0...v0.16.1) (2025-07-24)


### Bug Fixes

* **windows:** running dataform commands spawning new shell in windows platform ([1779b35](https://github.com/ashish10alex/vscode-dataform-tools/commit/1779b3522fc9ce111667f2f46d91304e0ebd43b4))

## [0.16.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.15.0...v0.16.0) (2025-07-23)


### Features

* refactored CLI binary location to be more resilient ([#172](https://github.com/ashish10alex/vscode-dataform-tools/issues/172)) ([9931281](https://github.com/ashish10alex/vscode-dataform-tools/commit/99312815b526bd05eac46c05fa5ddddc328449ce))


### Bug Fixes

* error when accessing `actionDescriptor` when moving to js file ([0526a71](https://github.com/ashish10alex/vscode-dataform-tools/commit/0526a712adb56584644d4d32bad102102df15503))
* use deny list of error messages for pre/post ops dry run ([#171](https://github.com/ashish10alex/vscode-dataform-tools/issues/171)) ([8a944c8](https://github.com/ashish10alex/vscode-dataform-tools/commit/8a944c85a445b2589e1e20b486b44cc2277d1165))

## [0.15.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.14.0...v0.15.0) (2025-07-15)


### Features

* **hover:** add column description & type hover definition ([#168](https://github.com/ashish10alex/vscode-dataform-tools/issues/168)) ([a0ddd79](https://github.com/ashish10alex/vscode-dataform-tools/commit/a0ddd79061136bcbcd4cdbe16d6d7c96558464f2))
* **snippet:** snippet to add description of columns to a model ([e0025aa](https://github.com/ashish10alex/vscode-dataform-tools/commit/e0025aa2a0ac5e2be52681656e4cd4aef72af41d))


### Documentation

* **blog:** add more examples of using compiler options ([4db19e8](https://github.com/ashish10alex/vscode-dataform-tools/commit/4db19e80cbd55f73554e2cb00e3169a343f212fc))

## [0.15.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.14.0...v0.15.0) (2025-07-15)


### Features

* **hover:** add column description & type hover definition ([#168](https://github.com/ashish10alex/vscode-dataform-tools/issues/168)) ([a0ddd79](https://github.com/ashish10alex/vscode-dataform-tools/commit/a0ddd79061136bcbcd4cdbe16d6d7c96558464f2))
* **snippet:** snippet to add description of columns to a model ([e0025aa](https://github.com/ashish10alex/vscode-dataform-tools/commit/e0025aa2a0ac5e2be52681656e4cd4aef72af41d))


### Documentation

* **blog:** add more examples of using compiler options ([4db19e8](https://github.com/ashish10alex/vscode-dataform-tools/commit/4db19e80cbd55f73554e2cb00e3169a343f212fc))

## [0.14.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.13.1...v0.14.0) (2025-06-26)


### ⚠ BREAKING CHANGES

* **sidebar:** side bar web view will no longer be available

### Features

* filter to only dataform workspaces when having multiple folders ([#164](https://github.com/ashish10alex/vscode-dataform-tools/issues/164)) ([810a47d](https://github.com/ashish10alex/vscode-dataform-tools/commit/810a47df6d1af46f2635788e548ed3c6b7cca3d5))
* update units to binary standard (GiB) instead of decimal (GB) ([#166](https://github.com/ashish10alex/vscode-dataform-tools/issues/166)) ([9cfd848](https://github.com/ashish10alex/vscode-dataform-tools/commit/9cfd8484097432d817b0b9801f613b60d7086b7e))


### Bug Fixes

* cost estimate table not loading ([#165](https://github.com/ashish10alex/vscode-dataform-tools/issues/165)) ([871f9be](https://github.com/ashish10alex/vscode-dataform-tools/commit/871f9be44ac0eb40bbc4060983442c074b923562))


### Performance

* **sidebar:** deprecate sidebar as most of it is shown in compiled query web panel ([#162](https://github.com/ashish10alex/vscode-dataform-tools/issues/162)) ([33675d4](https://github.com/ashish10alex/vscode-dataform-tools/commit/33675d4f38710e14fdaacea0b4c15888def2422a))

### [0.13.1](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.13.0...v0.13.1) (2025-06-16)


### Features

* add hover & snippet support for `${self()}` ([#159](https://github.com/ashish10alex/vscode-dataform-tools/issues/159)) ([e765d94](https://github.com/ashish10alex/vscode-dataform-tools/commit/e765d940968971124c2a2d83caec1a129cc29c06))
* surface authentication error to the compiled query ui ([#158](https://github.com/ashish10alex/vscode-dataform-tools/issues/158)) ([0a9ff28](https://github.com/ashish10alex/vscode-dataform-tools/commit/0a9ff2874314e5e71a5c7d97e48dd7b057030362))


### Bug Fixes

* incorrect termination of pre-orations when comment is present ([#161](https://github.com/ashish10alex/vscode-dataform-tools/issues/161)) ([99e2157](https://github.com/ashish10alex/vscode-dataform-tools/commit/99e2157012b03a8c4f74a053798e244b701fb440))

## [0.13.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.12.6...v0.13.0) (2025-06-05)


### Features

* show multiple costs & diagnostics for each operation ([#155](https://github.com/ashish10alex/vscode-dataform-tools/issues/155)) ([6bfbbc9](https://github.com/ashish10alex/vscode-dataform-tools/commit/6bfbbc9e08204860d8808bec8c5db232222c5d6c))

### [0.12.6](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.12.5...v0.12.6) (2025-05-23)


### Features

* **snippets:** publish, operate, assertion snippets for js files ([aa0398e](https://github.com/ashish10alex/vscode-dataform-tools/commit/aa0398e1f78215236a8723b0b6952655f49644f8))


### Bug Fixes

* js file with both operate and publish only shows first of of the two ([#154](https://github.com/ashish10alex/vscode-dataform-tools/issues/154)) ([906b63a](https://github.com/ashish10alex/vscode-dataform-tools/commit/906b63af6f1dfa033ae066e1a0f997a264d2bdff))

### [0.12.5](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.12.4...v0.12.5) (2025-05-14)


### Features

* add multi-root workspace support ([#121](https://github.com/ashish10alex/vscode-dataform-tools/issues/121)) ([4fb8151](https://github.com/ashish10alex/vscode-dataform-tools/commit/4fb815146004450b963e9d298b2ac805a0ccd2e1))

### [0.12.4](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.12.3...v0.12.4) (2025-05-06)


### Features

* **language:** add support for rename provider ([#149](https://github.com/ashish10alex/vscode-dataform-tools/issues/149)) ([11f3260](https://github.com/ashish10alex/vscode-dataform-tools/commit/11f326072a12595c3344ec681a7fc97b387acbe0))
* show min 200 rows when doing results preview ([c76be3b](https://github.com/ashish10alex/vscode-dataform-tools/commit/c76be3b365d1d32472858fc1beb3b0f027f52c87))


### Bug Fixes

* extension tests not running due to path issues ([#147](https://github.com/ashish10alex/vscode-dataform-tools/issues/147)) ([df73663](https://github.com/ashish10alex/vscode-dataform-tools/commit/df736635d1940f1e2d91307f193b79c59900095c))

### [0.12.3](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.12.2...v0.12.3) (2025-04-23)


### Bug Fixes

* bigquery results table not taking the container height ([5ec0d1f](https://github.com/ashish10alex/vscode-dataform-tools/commit/5ec0d1f7582149768a1d485c5f422cc88d9b417d))

### [0.12.2](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.12.1...v0.12.2) (2025-04-16)


### Features

* add blog section to website ([#146](https://github.com/ashish10alex/vscode-dataform-tools/issues/146)) ([92afeab](https://github.com/ashish10alex/vscode-dataform-tools/commit/92afeab4583cfb91516dad20fb846d91a0d54397))


### Documentation

* add faq to resolve `go to definition` functionality ([5e41d34](https://github.com/ashish10alex/vscode-dataform-tools/commit/5e41d342cd63b9d6b114b51cea8132cb12a5413b))

### [0.12.1](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.12.0...v0.12.1) (2025-04-10)


### Features

* add ability to specify compiler options directly from the ui ([#145](https://github.com/ashish10alex/vscode-dataform-tools/issues/145)) ([5c53a52](https://github.com/ashish10alex/vscode-dataform-tools/commit/5c53a52a3bdeb991cc1d8f1cf40d56aae3359a2d))
* **website:** update images shown in feature demo to have vertical aspect ratio ([bfc87e9](https://github.com/ashish10alex/vscode-dataform-tools/commit/bfc87e92e83e8b0aadffa43b82b6cbeeee6c2933))
* **website:** use carousel to flip through images ([#143](https://github.com/ashish10alex/vscode-dataform-tools/issues/143)) ([c19b1aa](https://github.com/ashish10alex/vscode-dataform-tools/commit/c19b1aa67c058b2d4576ccc5d6c9c9b20348e5ca))


### Documentation

* **website:** add more faqs ([239fdd4](https://github.com/ashish10alex/vscode-dataform-tools/commit/239fdd4fefc5713bffe141964d77170de08a80a0))

## [0.12.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.11.0...v0.12.0) (2025-04-09)


### Features

* **hover:** show documentation for commonly used BigQuery functions on hover ([#134](https://github.com/ashish10alex/vscode-dataform-tools/issues/134)) ([4439d11](https://github.com/ashish10alex/vscode-dataform-tools/commit/4439d11ae1e72f82c31888bb7468362bf4b72de7))
* **snippets:** add bigquery labels to snippets ([#138](https://github.com/ashish10alex/vscode-dataform-tools/issues/138)) ([e48aaff](https://github.com/ashish10alex/vscode-dataform-tools/commit/e48aaff123d39e52108bc9d9a8891e04ea0393b6))
* website for dataform tools vscode extension ([#139](https://github.com/ashish10alex/vscode-dataform-tools/issues/139)) ([3426118](https://github.com/ashish10alex/vscode-dataform-tools/commit/342611880d41e48d2fed0552147a50d9306e3fdb))
* **website:** show features available in table format with preview ([#141](https://github.com/ashish10alex/vscode-dataform-tools/issues/141)) ([20295d8](https://github.com/ashish10alex/vscode-dataform-tools/commit/20295d8e4f638048bad10cb2a5e008909e19afaf))


### Bug Fixes

* nav links not appearing on mobile ([#140](https://github.com/ashish10alex/vscode-dataform-tools/issues/140)) ([68d334c](https://github.com/ashish10alex/vscode-dataform-tools/commit/68d334cac506054e990c51d50d963e27ad465910))
* unnested struct columns not showing in results preview ([#136](https://github.com/ashish10alex/vscode-dataform-tools/issues/136)) ([0de34ca](https://github.com/ashish10alex/vscode-dataform-tools/commit/0de34ca67bc86a022ba1064e75dbc5ba2069166c))
* **website:** make main page fully visible in default view port ([#142](https://github.com/ashish10alex/vscode-dataform-tools/issues/142)) ([9e98b42](https://github.com/ashish10alex/vscode-dataform-tools/commit/9e98b42b1ee3dd69f27741b5290f9e53d434784c))

## [0.11.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.10.11...v0.11.0) (2025-03-25)


### Features

* remove double quotes from resulting json column document generation ([5747fda](https://github.com/ashish10alex/vscode-dataform-tools/commit/5747fda4553097ac84a02c6832e9b7c3fa63bd82))
* remove redundant active model metadata parsing ([#130](https://github.com/ashish10alex/vscode-dataform-tools/issues/130)) ([1b4ab7f](https://github.com/ashish10alex/vscode-dataform-tools/commit/1b4ab7f78c04d6029fb138140baba9778d39b818))


### Bug Fixes

* multiple assertions when ran does not show the correctly show failed assertions ([#132](https://github.com/ashish10alex/vscode-dataform-tools/issues/132)) ([e6b568a](https://github.com/ashish10alex/vscode-dataform-tools/commit/e6b568acf06e1f74a53703fe359606f2963c41e5))

### [0.10.11](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.10.10...v0.10.11) (2025-03-23)


### Features

* make multiple views/tables query visible from a single .js file ([#129](https://github.com/ashish10alex/vscode-dataform-tools/issues/129)) ([35f2f3a](https://github.com/ashish10alex/vscode-dataform-tools/commit/35f2f3ae3a97308e44933132f732c002f4f73679))

### [0.10.10](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.10.9...v0.10.10) (2025-03-20)


### Bug Fixes

* data preview cannot render struct types ([#126](https://github.com/ashish10alex/vscode-dataform-tools/issues/126)) ([8219ade](https://github.com/ashish10alex/vscode-dataform-tools/commit/8219ade03753f9d2a14bc9c6224adb955f925787))

### [0.10.9](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.10.8...v0.10.9) (2025-03-15)


### Bug Fixes

* css file missing ([9ff2720](https://github.com/ashish10alex/vscode-dataform-tools/commit/9ff27207f9b030f6688cfca8124565c5fee3069e))

### [0.10.8](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.10.7...v0.10.8) (2025-03-15)


### Features

* choose the active document even if it is not explicitly selected ([#123](https://github.com/ashish10alex/vscode-dataform-tools/issues/123)) ([b8e80da](https://github.com/ashish10alex/vscode-dataform-tools/commit/b8e80dabbca39c33ac43e17c24418d2d8e6d4866))


### Bug Fixes

* highlightjs-copy cdn links are not working, using minified dist files ([89ffd1a](https://github.com/ashish10alex/vscode-dataform-tools/commit/89ffd1afe50e19cb1194ac49f70d1aec91a0a3b4))

### [0.10.7](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.10.6...v0.10.7) (2025-03-13)

### Features

* choose the active document even if it is not explicitly selected (#123) ([#123](https://github.com/ashish10alex/vscode-dataform-tools/pull/123))

### [0.10.6](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.10.5...v0.10.6) (2025-03-06)


### Bug Fixes

* run current file not getting active document that is not explicitly saved ([8688990](https://github.com/ashish10alex/vscode-dataform-tools/commit/86889909b917cbf9e9c4f82801214131ff539a5d))

### [0.10.5](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.10.4...v0.10.5) (2025-03-06)


### Features

* **build:** improve debugging experience by automatically running vite build ([a06701b](https://github.com/ashish10alex/vscode-dataform-tools/commit/a06701b77e7ff32c22830915a3a02eaaf161ebbd))
* create model documentation by directly editing schema table ([#115](https://github.com/ashish10alex/vscode-dataform-tools/issues/115)) ([ec08414](https://github.com/ashish10alex/vscode-dataform-tools/commit/ec08414e7a13ce97817259fa5e0cf430264d7b33))
* support for native `format Document`  ([#118](https://github.com/ashish10alex/vscode-dataform-tools/issues/118)) ([dc0417c](https://github.com/ashish10alex/vscode-dataform-tools/commit/dc0417ca9d1a9345fd43aa391aa760112d266741))
* update README ([13f8d96](https://github.com/ashish10alex/vscode-dataform-tools/commit/13f8d9643fdb56d6b43fff8fb1edc06cd6414069))


### Bug Fixes

* unable to use bigquery client when global default project does have BigQuery enabled  ([#119](https://github.com/ashish10alex/vscode-dataform-tools/issues/119)) ([13d9605](https://github.com/ashish10alex/vscode-dataform-tools/commit/13d9605188b3b6ab73f681386d11c123c80fb64a))

### [0.10.4](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.10.3...v0.10.4) (2025-03-02)


### Bug Fixes

* no graph shown if one of the edges does not have a tag property ([4f5575c](https://github.com/ashish10alex/vscode-dataform-tools/commit/4f5575c6a0cd4a0df1c828a0c83bb5c3c3b46023))
* type error ([44fa5b6](https://github.com/ashish10alex/vscode-dataform-tools/commit/44fa5b64d76470c31687907f9eb424b04c5f160a))

### [0.10.3](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.10.2...v0.10.3) (2025-03-02)


### Features

* deprecate command to show graph by right clicking a ref ([ee98ae3](https://github.com/ashish10alex/vscode-dataform-tools/commit/ee98ae302dd0ee90a82b206d752a95b909d1202a))
* filter dependancy graph by selecting a tag ([#113](https://github.com/ashish10alex/vscode-dataform-tools/issues/113)) ([7a5c28a](https://github.com/ashish10alex/vscode-dataform-tools/commit/7a5c28a77e2383483e1583f3c0d2e45a445b56cc))
* reduce bundle size, we only need compiled minfied react code ([2b37f54](https://github.com/ashish10alex/vscode-dataform-tools/commit/2b37f54e74cdd0bc8ddbca601a1983fecfcd0c37))

### [0.10.3](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.10.2...v0.10.3) (2025-03-02)


### Features

* deprecate command to show graph by right clicking a ref ([ee98ae3](https://github.com/ashish10alex/vscode-dataform-tools/commit/ee98ae302dd0ee90a82b206d752a95b909d1202a))
* filter dependancy graph by selecting a tag ([#113](https://github.com/ashish10alex/vscode-dataform-tools/issues/113)) ([7a5c28a](https://github.com/ashish10alex/vscode-dataform-tools/commit/7a5c28a77e2383483e1583f3c0d2e45a445b56cc))
* reduce bundle size, we only need compiled minfied react code ([2b37f54](https://github.com/ashish10alex/vscode-dataform-tools/commit/2b37f54e74cdd0bc8ddbca601a1983fecfcd0c37))

### [0.10.2](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.10.1...v0.10.2) (2025-03-01)


### Features

* improved dynamic loading of dependancy graph when webview is mounted ([#111](https://github.com/ashish10alex/vscode-dataform-tools/issues/111)) ([c770461](https://github.com/ashish10alex/vscode-dataform-tools/commit/c770461d02ffa842527c55707afe3dea7c5c0f41))
* reduce bundle size by excluding files not required by extension ([#112](https://github.com/ashish10alex/vscode-dataform-tools/issues/112)) ([26512d7](https://github.com/ashish10alex/vscode-dataform-tools/commit/26512d7da83a8474cefacb88eee88163a5e3a69c))

### [0.10.1](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.10.0...v0.10.1) (2025-02-28)


### Bug Fixes

* unable to draw graph on slower machines, increase delay to 400ms ([40cd617](https://github.com/ashish10alex/vscode-dataform-tools/commit/40cd61782222ffb8567e6f8c40ca66526f756f76))

## [0.10.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.9.4...v0.10.0) (2025-02-27)


### Features

* modern depedancy graph webview with reactflow ([#109](https://github.com/ashish10alex/vscode-dataform-tools/issues/109)) ([a49c313](https://github.com/ashish10alex/vscode-dataform-tools/commit/a49c313cd2b5e1caa084ff134382cc723d032121))

### [0.9.4](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.9.3...v0.9.4) (2025-02-18)


### Bug Fixes

* formatter not using last active editor when switching to an non editor window ([5ad869d](https://github.com/ashish10alex/vscode-dataform-tools/commit/5ad869dce76784e9545bf0eed573cf641f256956))

### [0.9.3](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.9.2...v0.9.3) (2025-02-16)


### Features

* support debug logging ([#108](https://github.com/ashish10alex/vscode-dataform-tools/issues/108)) ([982d8b4](https://github.com/ashish10alex/vscode-dataform-tools/commit/982d8b4154cbaa83372b6ed1dcd91ed0627e64ec))

### [0.9.2](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.9.1...v0.9.2) (2025-02-11)


### Features

* go to definition for CTEs ([086a95b](https://github.com/ashish10alex/vscode-dataform-tools/commit/086a95b9408775469ee64f0dc352ce5eae55e3df))

### [0.9.1](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.9.0...v0.9.1) (2025-02-09)


### Features

* **ui:** compiled query stats looks better with contrast ([e7be512](https://github.com/ashish10alex/vscode-dataform-tools/commit/e7be5128e7d9112c1108224492bf035b4cc5b853))

## [0.9.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.8.6...v0.9.0) (2025-02-09)


### Features

* ability to specify local/global installation of dataform cli  ([#99](https://github.com/ashish10alex/vscode-dataform-tools/issues/99)) ([aeb0667](https://github.com/ashish10alex/vscode-dataform-tools/commit/aeb0667b65a0b8f370f50fcb957b7bd9a9b8cae2))
* add format button in compiled query web view ([#103](https://github.com/ashish10alex/vscode-dataform-tools/issues/103)) ([71c25a5](https://github.com/ashish10alex/vscode-dataform-tools/commit/71c25a50662dd1c95861ba7d36f821836588316f))
* **format:** formatting using dataform cli ([#106](https://github.com/ashish10alex/vscode-dataform-tools/issues/106)) ([4f23cca](https://github.com/ashish10alex/vscode-dataform-tools/commit/4f23cca2fe097e26c2b9297cc53e33b6de18a6b5))
* **formatting:** add option to specify path to sqlfluff binary ([#101](https://github.com/ashish10alex/vscode-dataform-tools/issues/101)) ([80e7a9c](https://github.com/ashish10alex/vscode-dataform-tools/commit/80e7a9c3f3883a04ceb55f5a635a3bbbb157fed9))
* improve compiled query ui ([fa47b38](https://github.com/ashish10alex/vscode-dataform-tools/commit/fa47b38e5d18747434a44d55bf85cf9a39ff7612))
* revamp compiled query ui ([#104](https://github.com/ashish10alex/vscode-dataform-tools/issues/104)) ([3db128d](https://github.com/ashish10alex/vscode-dataform-tools/commit/3db128df934c9eab3c6c313d4e12a9b4cd83f576))
* sqlfluff config file with support for incremental js query ([fde0e2c](https://github.com/ashish10alex/vscode-dataform-tools/commit/fde0e2c38c04f0bac62d21f5fd8e5bcb6ba4c124))


### Documentation

* add description to extension ([22c2e66](https://github.com/ashish10alex/vscode-dataform-tools/commit/22c2e6664b15af15375966e137e52bfc829241ee))

### [0.8.6](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.8.5...v0.8.6) (2025-02-04)


### Features

* **theme:** improved support for light theme ([7759a21](https://github.com/ashish10alex/vscode-dataform-tools/commit/7759a2140f70668a7dab0760a460d9281c9ab842))


### Bug Fixes

* no error message when user compiled without having file opened ([#98](https://github.com/ashish10alex/vscode-dataform-tools/issues/98)) ([8f6d775](https://github.com/ashish10alex/vscode-dataform-tools/commit/8f6d7759ca9a136b8384b25eeb6db599a0ee4ede))
* theme switch in high contrast light mode ([db83284](https://github.com/ashish10alex/vscode-dataform-tools/commit/db8328483758ec9ba97fdd48a4c46dbf5914be7a))

### [0.8.5](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.8.4...v0.8.5) (2025-01-26)


### Features

* **query:** use Big Query job end time instead of current time as job end time ([e7386cd](https://github.com/ashish10alex/vscode-dataform-tools/commit/e7386cde29d6ee78cd11a22c13e6044f57ccd69d))


### Bug Fixes

* `Show compiled query in vertical split` command broken ([8f28ba8](https://github.com/ashish10alex/vscode-dataform-tools/commit/8f28ba86df3cea3d0a4580fc0326484bd6868917))


### Documentation

* officially the recommended vscode extension as of Dataform v3.0.10 ([96985d1](https://github.com/ashish10alex/vscode-dataform-tools/commit/96985d1e0a6651d180cf582f0de6daf2b16e1ab9))

### [0.8.4](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.8.3...v0.8.4) (2025-01-22)


### Bug Fixes

* **ui:** report issue widget getting frozen at the top when scrolling ([5d3a4dc](https://github.com/ashish10alex/vscode-dataform-tools/commit/5d3a4dc2d2f4571dfb15f04e52337f46dbc2e329))


### Performance

* **query:** show query ui right before query in ran in BigQuery ([e494677](https://github.com/ashish10alex/vscode-dataform-tools/commit/e494677530d871f71267ba00bc1369e637db2023))


### Styling

* **table:** match the colorscheme of vscode default dark theme for tables ([0d08ef0](https://github.com/ashish10alex/vscode-dataform-tools/commit/0d08ef00c3472ead1f9a3ef28aeddf07f551d0d9))

### [0.8.3](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.8.2...v0.8.3) (2025-01-22)


### Features

* **codeLens:** ability to preview assertion results from config block ([2dafa7e](https://github.com/ashish10alex/vscode-dataform-tools/commit/2dafa7e7e9099540dff7ca395a96456964ea7d70))
* **style:** consistent ui ([ddef8bc](https://github.com/ashish10alex/vscode-dataform-tools/commit/ddef8bce7f74dadeed63fdf8fcaa720e8a79c0fc))


### Bug Fixes

* when query returns no results cache was not cleared ([93a02fd](https://github.com/ashish10alex/vscode-dataform-tools/commit/93a02fd405c799b220b70b705430225950c61a2a))

### [0.8.2](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.8.1...v0.8.2) (2025-01-20)


### Features

* add a widget for user to navigate to create issues ([29dc171](https://github.com/ashish10alex/vscode-dataform-tools/commit/29dc1715432fb08cf24671201c0fb3e2d5b08e7f))
* **hover:** assertion hover documentation ([00bb02f](https://github.com/ashish10alex/vscode-dataform-tools/commit/00bb02fcd74647a94575fa5c1f1cab667fa3fbae))
* show model lastModifiedTime in compiled query webview ([#92](https://github.com/ashish10alex/vscode-dataform-tools/issues/92)) ([58bb8e1](https://github.com/ashish10alex/vscode-dataform-tools/commit/58bb8e1e879be7272a1d66b36b2c2ce355555a42))

### [0.8.1](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.8.0...v0.8.1) (2025-01-16)


### Features

* add copy full model name button ([c571c63](https://github.com/ashish10alex/vscode-dataform-tools/commit/c571c636b27e54fbfd46568dcde91bbc41a3cbbd))
* **completion:** use a generic selector for completion items. ([3066dfd](https://github.com/ashish10alex/vscode-dataform-tools/commit/3066dfdd5d29c0d99bb7ea29b4b4b85b22450e8c))
* ensure result panel fits in the container ([3ae835f](https://github.com/ashish10alex/vscode-dataform-tools/commit/3ae835fc0fe8d59cd27ba529e21f1837c8c79cff))

## [0.8.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.7.11...v0.8.0) (2025-01-13)


### Features

* add code lens to run a tag ([9f6b04e](https://github.com/ashish10alex/vscode-dataform-tools/commit/9f6b04e3c1f12d78a6c24204134330e5945439ea))
* estimate the cost of running a tag from web view ([#87](https://github.com/ashish10alex/vscode-dataform-tools/issues/87)) ([7aab65e](https://github.com/ashish10alex/vscode-dataform-tools/commit/7aab65e158015a706b089998a64aa5852bb356e7))
* **snippets:** assertions and bigquery options in config block ([e2c6ec6](https://github.com/ashish10alex/vscode-dataform-tools/commit/e2c6ec66344cb6223c9cb313b0f0c07331133afc))


### Bug Fixes

* backward  compatibility broken for Dataform v2.x ([#86](https://github.com/ashish10alex/vscode-dataform-tools/issues/86)) ([7f921fc](https://github.com/ashish10alex/vscode-dataform-tools/commit/7f921fc22f2a49b1681af9aab467dd5dbaf457e3))

### [0.7.11](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.7.10...v0.7.11) (2025-01-11)


### Bug Fixes

* dry run stats not showing for `operations` ([9afbb70](https://github.com/ashish10alex/vscode-dataform-tools/commit/9afbb70b8a5e5bba378970925a423fe844388171))


### Performance

* **compilation:** no need to loop through operation if it is of type table, view, operations ([8bf4132](https://github.com/ashish10alex/vscode-dataform-tools/commit/8bf4132633ceb5c11be3ae44fe0ef9e34cadee1a))

### [0.7.10](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.7.9...v0.7.10) (2025-01-11)


### Bug Fixes

* unable to preview results of type `operations` ([6e717d4](https://github.com/ashish10alex/vscode-dataform-tools/commit/6e717d4ed8cae52df7e0a34a084919c482b291c9))

### [0.7.9](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.7.8...v0.7.9) (2025-01-10)


### Bug Fixes

* [#89](https://github.com/ashish10alex/vscode-dataform-tools/issues/89) semicolon added to end of operations ([#90](https://github.com/ashish10alex/vscode-dataform-tools/issues/90)) ([6a7e149](https://github.com/ashish10alex/vscode-dataform-tools/commit/6a7e1496cf78ddf3a8fd372c6103114bef45e399))

### [0.7.8](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.7.7...v0.7.8) (2025-01-09)


### Bug Fixes

* operation does not appear if no table / assertions are present ([930a3fe](https://github.com/ashish10alex/vscode-dataform-tools/commit/930a3fec979a17d931977c6f29282c2c17001fcc))

### [0.7.7](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.7.6...v0.7.7) (2025-01-09)


### Features

* add snippet for `except` keyword ([e217f0d](https://github.com/ashish10alex/vscode-dataform-tools/commit/e217f0d52a6b45df181f0465c3a877892c937a1a))


### Bug Fixes

* long descriptions not visible in schema webview ([9e91008](https://github.com/ashish10alex/vscode-dataform-tools/commit/9e9100849fa0aabc152d153f1db850e8f5220f0f))

### [0.7.6](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.7.5...v0.7.6) (2025-01-05)


### Features

* improve error messages  ([#85](https://github.com/ashish10alex/vscode-dataform-tools/issues/85)) ([38a147b](https://github.com/ashish10alex/vscode-dataform-tools/commit/38a147bc098860f8829c5e72da26525b77c203f8))
* show error message & possible resolution on file case change [issue](https://github.com/microsoft/vscode/issues/123660) in vscode ([ddbe46d](https://github.com/ashish10alex/vscode-dataform-tools/commit/ddbe46d383138f3c42fec5afb9321d93ee879dc0))

### [0.7.5](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.7.4...v0.7.5) (2025-01-02)


### Bug Fixes

* bigquery job will return no results if job takes longer than 10sec ([5c034ca](https://github.com/ashish10alex/vscode-dataform-tools/commit/5c034ca17c278a2449ef9fc985fdf283517426f0))

### [0.7.4](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.7.3...v0.7.4) (2025-01-02)


### Features

* show hint to user that the workspace is not a Dataform workspace ([ef15f6d](https://github.com/ashish10alex/vscode-dataform-tools/commit/ef15f6d690cb10c3f3353f89c2acf5b0bcd13713))


### Bug Fixes

* schema not showing when number of column is high(e.g ~100) ([e7ee2cd](https://github.com/ashish10alex/vscode-dataform-tools/commit/e7ee2cd57bc43cd46d6a63e62597aace55416a2a))

### [0.7.3](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.7.2...v0.7.3) (2025-01-01)


### Features

* update tabulator and prevent redundant data flowing to webview ([de745b6](https://github.com/ashish10alex/vscode-dataform-tools/commit/de745b6d9eb7d40cdb6b2f501fd247aeec9f1bea))

### [0.7.2](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.7.1...v0.7.2) (2025-01-01)


### Features

* add link to YouTube video with setup and demo ([b7ce997](https://github.com/ashish10alex/vscode-dataform-tools/commit/b7ce9973dc94e2b253b2f583d59363a872a81904))

### [0.7.1](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.7.0...v0.7.1) (2024-12-30)


### Features

* **installation:** add hint to install dataform cli using error message on windows platform ([30b7ea4](https://github.com/ashish10alex/vscode-dataform-tools/commit/30b7ea4ece9690e085237c2edde5aaa7f335e76e))


### Bug Fixes

* **panel:** error message appears 3 times if there are pre/post ops and gcloud not setup ([e92a666](https://github.com/ashish10alex/vscode-dataform-tools/commit/e92a6660e0a06b4d1c4986fd1053c37861ef47c4))

## [0.7.0](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.6.4...v0.7.0) (2024-12-30)


### Features

*  refactor `getQueryMetaForCurrentFile` to be more functional  ([#83](https://github.com/ashish10alex/vscode-dataform-tools/issues/83)) ([b96fe4b](https://github.com/ashish10alex/vscode-dataform-tools/commit/b96fe4b09b9bc6a4546dea788c6b24e8f6da56bc))
* add `CONTRIBUTING.md` ([2be9172](https://github.com/ashish10alex/vscode-dataform-tools/commit/2be9172deac5f81b7ef32f1f10a99236a95707d6))
* capitalize the prefix for BigQuery snippets ([ed003a3](https://github.com/ashish10alex/vscode-dataform-tools/commit/ed003a3fc1d9669a8630fb93a5d758faa2bb5030))
* do not compile on extension activation making the activation faster ([23fdf06](https://github.com/ashish10alex/vscode-dataform-tools/commit/23fdf06ff84745a6162f876e385db2ec936c790c))
* **hover:** make hover docs for base sources more visible ([5d3824e](https://github.com/ashish10alex/vscode-dataform-tools/commit/5d3824edef765061da46ea0577dca036bc55bef1))
* make testing work again and improve coverage  ([#84](https://github.com/ashish10alex/vscode-dataform-tools/issues/84)) ([2d23439](https://github.com/ashish10alex/vscode-dataform-tools/commit/2d23439ff3e6b485eba6f665482aefb3c523599e))
* optimize external deps computation ([cd609ec](https://github.com/ashish10alex/vscode-dataform-tools/commit/cd609ec23bfd43a99cd6e3de5ed999a7832c4c43))
* propagate pre and post operation errors to webview ([#82](https://github.com/ashish10alex/vscode-dataform-tools/issues/82)) ([2de85ee](https://github.com/ashish10alex/vscode-dataform-tools/commit/2de85ee431cb603b6c79209078e37848697529e7))
* recommend user to install error lens extension ([77a7eab](https://github.com/ashish10alex/vscode-dataform-tools/commit/77a7eabb9491c0256b047cc13f38a91a78973650))
* show column description in the  table schema  ([#79](https://github.com/ashish10alex/vscode-dataform-tools/issues/79)) ([0bbd35b](https://github.com/ashish10alex/vscode-dataform-tools/commit/0bbd35b32fe529ffd469d4ec15b84d1873f5b540))
* show external deps first ([0d37bbe](https://github.com/ashish10alex/vscode-dataform-tools/commit/0d37bbea7a21686efaf453f385e95faa2175669c))
* show link to bigquery job when assertion passes ([11a0de8](https://github.com/ashish10alex/vscode-dataform-tools/commit/11a0de8c15a45682117664904c33f3753b297ba3))
* trigger table run & data preview directly from compiled web ui ([#77](https://github.com/ashish10alex/vscode-dataform-tools/issues/77)) ([187ef72](https://github.com/ashish10alex/vscode-dataform-tools/commit/187ef7219c2c00cb639f735e95f04bc7302f33e0))


### Bug Fixes

* assertion not showing error when bigquery job fails ([8e6fcaa](https://github.com/ashish10alex/vscode-dataform-tools/commit/8e6fcaa5e3beacc1468a0494b728711640b4c206))
* content getting truncated when the number of items exceeds expected amount ([aa3f5db](https://github.com/ashish10alex/vscode-dataform-tools/commit/aa3f5db6afa62307d5ee8c6f92acf252b6ac26a6))
* dry run not working with @[@query](https://github.com/query)_label ([#80](https://github.com/ashish10alex/vscode-dataform-tools/issues/80)) ([35441ff](https://github.com/ashish10alex/vscode-dataform-tools/commit/35441ffdc6103b3ad5930dfcb69eff29ec6513e6))
* error attempting to fetch dependents for an undefined target ([5b5fd98](https://github.com/ashish10alex/vscode-dataform-tools/commit/5b5fd989a6b18d35a355357749f3426824ad5958))
* incremental model showing as external dependency ([59aa1de](https://github.com/ashish10alex/vscode-dataform-tools/commit/59aa1dea68a31e85608534526d3fd028cd7ac3d1))
* nav bar not visible in light mode ([76adc84](https://github.com/ashish10alex/vscode-dataform-tools/commit/76adc841114ffdc025a89c143ad16ec9bb9309a7))
* set @[@query](https://github.com/query)_label was not being escaped when lower case ([6e9d279](https://github.com/ashish10alex/vscode-dataform-tools/commit/6e9d279e9b8ba9375be849b38e4c0cb10d526bc5))

### [0.6.4](https://github.com/ashish10alex/vscode-dataform-tools/compare/v0.6.3...v0.6.4) (2024-12-20)


### Features

* show hint to resolve bigquery client issue ([1c5e1af](https://github.com/ashish10alex/vscode-dataform-tools/commit/1c5e1afed6ec034ebdc19fcfe4e7a14c3c60918a))
* show hint to the user if they have not install dataform cli ([9fce2a0](https://github.com/ashish10alex/vscode-dataform-tools/commit/9fce2a05f904006a392bcc92ef8395ebc887a8c8))
* show user potential error resolution steps ([f3a4365](https://github.com/ashish10alex/vscode-dataform-tools/commit/f3a43653ad84c2e2e1ad1c0647a6ff257a245539))


### Bug Fixes

* does not compile when path to repo has spaces in windows, e.g. One Drive ([dafee26](https://github.com/ashish10alex/vscode-dataform-tools/commit/dafee26f3f0694b8d6df9b293a5e4a77213ae72a))

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

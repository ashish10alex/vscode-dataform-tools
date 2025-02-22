
# Requirements

* `node v18` or higher
* `npm` (gets installed alongside node)
* [Dataform cli](https://cloud.google.com/dataform/docs/use-dataform-cli)
* Install and setup [gcloud cli](https://cloud.google.com/sdk/docs/install) for your operating system

## How to contribute

[1. Build and make changes to the extension]()

* Fork this repository, clone it to your desktop and open it in VSCode
* Run `npm install` in your terminal to install all the dependencies
* Click the `Run and debug` icon on the left hand pane of your editor and click on `Run Extension` button

    <img src="media/images/dataform_tools_run_and_debug.png" alt="compilation" width="300">

* This should open a new VSCode window where you can open a Dataform project. Make sure that you folder opened in the workspace is at the root of the Dataform project. For example if your Dataform project is located at `~/repos/my_dataform_project` open the workspace at `~/repos/my_dataform_project`, **NOT** `~/repos`. Such that either `workflow_settings.yaml` or `dataform.json` depending on the Dataform version you are using is located at the root of the VSCode workspace.

[2. Make your changes]()

Make the desired changes to the `vscode-dataform-tools` repo and re-run/refresh the compilation to see the desired outcome in the new VSCode window

[Test your changes]()

* **Test your changes** on your Dataform repository. If you are running linux based operating system run `npm run test` on your terminal to verify if the exsisiting tests are pasing. There are some caveats with running tests, so do not panic if the test fail to run. The test would not be able to run if your project path is very long this is a [known issue reported here](https://github.com/microsoft/vscode-test/issues/232). Also, we are having to remove `.vscode-test/user-data` before running `vscode-test` in the `npm run test` script in `package.json`. These tests currently are only tested to be running on Mac OS. We will need to change the script for `npm run test` in `package.json` for it to work in multiple operating systems.

* Run `npm install markdownlint-cli2 --global` to install markdown linter and run `markdownlint-cli2 README.md` to verify the Markdown is correctly formatted if you have made any changes there.

### Open an issue / pull request

[If you'd like the feature or bug fix to be merged]()

* Check the exsisting issues to make sure that if it has not been already raised
* [Create an issue here](https://github.com/ashish10alex/vscode-dataform-tools/issues)
* [Create a pull request here](https://github.com/ashish10alex/vscode-dataform-tools/pulls)

## React webview

We are using [React Flow](https://reactflow.dev/) to create the dependency graph.  To build `dist/webview.js` run `./node_modules/.bin/vite build` in the terminal. This will watch for changes and rebuild the `dist/webview.js` file.

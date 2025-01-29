
### <a id="faq">Frequently asked questions</a>

1. [Unable to execute command e.g. error]() `command vscode-dataform-tools.xxx not found`

   * It is likely that the vscode workspace folder is not opened at the root of your dataform project. For example, if your dataform project is located at `~/Documents/repos/my_dataform_project` ensure that workspace is opened at
   `~/Documents/repos/my_dataform_project` NOT `~/Documents/repos/my_dataform_project`
   * The above design is to facilitate the exection of `dataform compile --json` command without infering the dataform root at run time

2. [Error compiling Dataform, process existed with exit code 1]()
   * Check if correct dataform cli version is installed by running `dataform --version` in your terminal
   * Ensure that dataform cli version matches the version required by the project
   * Try compiling the project by running `dataform compile` on your terminal from the root of your dataform project
   * In case you need to install a specific dataform cli version by running `npm i -g @dataform/cli@2.9.0`. Make sure you verify the version by running the `dataform --version`
   * In case the error is not due to all the above reasons it is likely that you have a compilation error in your pipeline

3. [Dataform encountered an error: Missing credentials JSON file; not found at path <your_project_path>/.df-credentials.json]()
   * Run `dataform init-creds` from the from the root of your dataform project in your terminal
   * You will be promted to pick the location and type of authentication `json/adc`. Choosing adc will be use your default gcp credentials that you had setup using `gcloud`

4. [I do not want to see compiled query each time I save it]()
   * Open vscode settings and search for Dataform and uncheck the following setting
   ![disable_save_on_compile](/media/images/disable_save_on_compile.png)

5. [I want the autocompletion to be of the format  `${ref('dataset_name', 'table_name)}` instead of `${ref('table_name')}`]()
   * Open vscode settings and search for Dataform and select the prefered autocompletion format
   ![disable_save_on_compile](/media/images/preferred_autocompletion.png)

6. [I want to use local installation of dataform cli instead of global one | OR | I have to use different version of Dataform cli for a workspace]()
   * If you install dataform cli using `npm install -g @dataform/cli` it will install the dataform cli
      globally making only one version available everywhere.  If you have varing Dataform version requeriement for a workspace
      you can installation dataform cli version specific to that workspace by running `npm install @dataform/cli` notice the absence of `-g` flag as compared to the previous command. Running `npm install @dataform/cli` will install dataform cli at `./node_modules/.bin/dataform`. To make the extension use dataform cli installated in local scope open
     settings and select local for `Dataform Cli Scope` as shown in the screenshot below.

     ![cli_scope](/media/images/cli_scope.png)

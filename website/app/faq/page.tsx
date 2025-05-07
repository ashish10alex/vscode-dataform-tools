export default function FAQPage() {
  const faqs = [
    {
      question: "What operating systems does Dataform Tools support?",
      answer:
        "Dataform Tools supports Windows, MacOS, and Linux.",
    },
    {
      question: "What is the minimum version of VS Code required to use Dataform Tools?",
      answer:
        "Dataform Tools requires VS Code version 1.89.0 or higher.",
    },
    {
      question: "I'm seeing 'Dataform encountered an error: Missing credentials JSON file; not found at path <your_project_path>/.df-credentials.json'",
      answer:
        "Run `dataform init-creds` from the root of your dataform project in your terminal. You will be prompted to pick the location and type of authentication (json/adc). Choosing adc will use your default GCP credentials that you had setup using gcloud.",
    },
    {
      question: "I'm getting an error: 'command vscode-dataform-tools.xxx not found'. What should I do?",
      answer:
        "It is likely that the VS Code workspace folder is not opened at the root of your dataform project. For example, if your dataform project is located at ~/Documents/repos/my_dataform_project ensure that workspace is opened at ~/Documents/repos/my_dataform_project NOT ~/Documents/repos. This design facilitates the execution of dataform compile --json command without inferring the dataform root at runtime.",
    },
    {
      question: "I'm getting 'Error compiling Dataform, process exited with exit code 1'. How do I fix this?",
      answer:
        "Check if the correct dataform CLI version is installed by running dataform --version in your terminal. Ensure that dataform CLI version matches the version required by the project. Try compiling the project by running dataform compile on your terminal from the root of your dataform project. To install a specific dataform CLI version, run npm i -g @dataform/cli@x.x.x (replace with the required version). If the error persists, you likely have a compilation error in your pipeline.",
    },
    {
      question: "How can I stop seeing compiled queries each time I save?",
      answer:
        "Open VS Code settings and search for Dataform. Then uncheck the 'Show compiled query on save' setting.",
    },
    {
      question: "How can I change the autocompletion format for references? (default: ${ref('table_name')})",
      answer:
        "Open VS Code settings, search for Dataform, and select your preferred autocompletion format from the dropdown options. You can choose between `${ref('table_name')}`, `${ref('dataset_name', 'table_name')}`, or `${ref({schema:'dataset_name', name:'table_name'})}`.",
    },
    {
      question: "How can I use a local installation of dataform CLI instead of a global one?",
      answer:
        "If you need different Dataform CLI versions for different workspaces, you can install dataform CLI locally by running `npm install @dataform/cli` (without the `-g` flag) in your project directory. This will install dataform CLI at `./node_modules/.bin/dataform`. To make the extension use the locally installed CLI, open settings and select `local` for the `Dataform CLI Scope` option.",
    },
    {
      question: "I do not see go to definition option when right clicking references `${ref('table_name')}`",
      answer:
        "Check if you language mode when sqlx file is open is set to `sqlx`. VSCode sometimes sets it as a different flavour of sql. You can change that by opening the command pallet and searching for `change language mode` followed by `Configure language association for sqlx` and selecting `sqlx` from the list of available options. This should also resolve hover information not being visible as the all the language specific behaviors are tied to file being inferred as sqlx file.",
    }

  ];

  return (
    <div className="container py-8 md:py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight mb-8">
          Frequently Asked Questions
        </h1>
        <div className="space-y-6">
          {faqs.map((faq, index) => (
            <div key={index} className="border-b pb-6">
              <h3 className="text-lg font-semibold mb-2">
                <span className="mr-2 text-primary">{index + 1}.</span>
                {faq.question}
              </h3>
              <p className="text-muted-foreground">{faq.answer}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
} 
import FeatureReels from "@/components/feature-reels";
import { CodeBlock } from "@/components/code-block";
import { InstallationStepHeader } from "@/components/installation-step-header";

export default function InstallationGuidePage() {
  return (
    <main className="flex-1">
      <section className="container py-8">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          {/* Installation Section - Left Side */}
          <div className="md:col-span-7">
            <div className="max-w-3xl md:max-w-none px-4">
              <p className="text-muted-foreground mb-8 dark:text-gray-400">
                Installation steps for Dataform tools VSCode extension.
                Once you have installed the extension on VSCode, follow the steps below.
                Alternatively, you can watch one of the setup videos shown on the right.
              </p>
              
              <div className="space-y-10">
                {/* Dataform CLI */}
                <div>
                  <InstallationStepHeader 
                    number={1} 
                    title="Dataform CLI" 
                    link="https://cloud.google.com/dataform/docs/use-dataform-cli" 
                  />
                  <CodeBlock 
                    title="Install Dataform CLI using npm (requires nodejs)"
                    code="npm i -g @dataform/cli"
                    language="bash"
                  />
                  <p className="mt-2 text-sm text-muted-foreground dark:text-gray-400">
                    Run <code className="px-1.5 py-0.5 rounded-md bg-muted dark:bg-gray-800 text-muted-foreground font-mono text-sm dark:text-gray-300">dataform compile</code> from the <b>root of your Dataform project </b> to ensure that you are able to use the CLI.
                  </p>
                </div>

                {/* Install gcloud CLI */}
                <div>
                  <InstallationStepHeader 
                    number={2} 
                    title="Google Cloud CLI" 
                    link="https://cloud.google.com/sdk/docs/install" 
                  />
                  <CodeBlock 
                    title="Initialize gcloud:"
                    code="gcloud init"
                    language="bash"
                  />
                  
                  <CodeBlock 
                    title="Set up application default credentials:"
                    code="gcloud auth application-default login"
                    language="bash"
                    className="mt-4"
                  />
                  
                  <CodeBlock 
                    title="Set your GCP project:"
                    code="gcloud config set project <project_id> #replace with your gcp project id"
                    language="bash"
                    className="mt-4"
                  />
                </div>

                {/* SQLFluff */}
                <div>
                  <InstallationStepHeader 
                    number={3} 
                    title="SQLFluff" 
                    link="https://github.com/sqlfluff/sqlfluff" 
                  />
                  <CodeBlock 
                    title="Install SQLFluff for SQL formatting (requires python):"
                    code="pip install sqlfluff"
                    language="bash"
                  />
                </div>

                {/* Error Lens */}
                <div>
                  <InstallationStepHeader 
                    number={4} 
                    title="Error Lens Extension" 
                    link="https://marketplace.visualstudio.com/items?itemName=usernamehw.errorlens" 
                    isOptional={true}
                  />
                  <p className="text-sm text-muted-foreground dark:text-gray-400">
                    Install the Error Lens VS Code extension for prettier diagnostic messages.
                  </p>
                </div>

                {/* Note */}
                <div className="rounded-lg border border-border bg-muted p-4 dark:border-gray-700 dark:bg-gray-1000">
                  <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                      <path d="M12 16h.01"></path>
                      <path d="M12 8v4"></path>
                      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"></path>
                    </svg>
                    <h3 className="font-medium dark:text-white">Note</h3>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground dark:text-gray-300">
                    <p>
                      Trouble installing or looking for a specific customization? Please see <a href="/faq" className="font-medium underline underline-offset-4">FAQ section</a>, if you are still stuck, please <a href="https://github.com/ashish10alex/vscode-dataform-tools/issues" className="font-medium underline underline-offset-4">raise an issue here</a>.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Feature Reels - Right Side */}
          <div className="md:col-span-5 md:order-last">
            <div className="sticky top-24">
              <FeatureReels />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
} 
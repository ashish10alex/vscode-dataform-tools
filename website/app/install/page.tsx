import FeatureReels from "@/components/feature-reels";
import { CodeBlock } from "@/components/code-block";

export default function InstallationGuidePage() {
  return (
    <main className="flex-1">
      <section className="container py-8">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          {/* Installation Section - Left Side */}
          <div className="md:col-span-7">
            <div className="max-w-3xl md:max-w-none px-4">
              <p className="text-muted-foreground mb-8 dark:text-gray-400">
                How to install and set up the required tools for Dataform tools VSCode extension.
              </p>
              
              <div className="space-y-10">
                {/* Dataform CLI */}
                <div>
                  <h2 className="text-xl font-semibold tracking-tight mb-4 flex items-center gap-2 dark:text-white">
                    <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-primary/10 text-primary text-sm">1</span>
                    <a href="https://cloud.google.com/dataform/docs/use-dataform-cli" className="hover:underline">Dataform CLI</a>
                  </h2>
                  <CodeBlock 
                    title="Install Dataform CLI using npm (requires nodejs)"
                    code="npm i -g @dataform/cli"
                    language="bash"
                  />
                  <p className="mt-2 text-sm text-muted-foreground dark:text-gray-400">
                    Run <code className="px-1.5 py-0.5 rounded-md bg-muted dark:bg-gray-800 text-muted-foreground font-mono text-sm dark:text-gray-300">dataform compile</code> from the root of your Dataform project to ensure that you are able to use the CLI.
                  </p>
                </div>

                {/* Install gcloud CLI */}
                <div>
                  <h2 className="text-xl font-semibold tracking-tight mb-4 flex items-center gap-2 dark:text-white">
                    <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-primary/10 text-primary text-sm">2</span>
                    <a href="https://cloud.google.com/sdk/docs/install" className="hover:underline">Google Cloud CLI</a>
                  </h2>
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
                  <h2 className="text-xl font-semibold tracking-tight mb-4 flex items-center gap-2 dark:text-white">
                    <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-primary/10 text-primary text-sm">3</span>
                    <a href="https://github.com/sqlfluff/sqlfluff" className="hover:underline">SQLFluff</a>
                  </h2>
                  <CodeBlock 
                    title="Install SQLFluff for SQL formatting (requires python):"
                    code="pip install sqlfluff"
                    language="bash"
                  />
                </div>

                {/* Error Lens */}
                <div>
                  <h2 className="text-xl font-semibold tracking-tight mb-4 flex items-center gap-2 dark:text-white">
                    <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-primary/10 text-primary text-sm">4</span>
                    <a href="https://marketplace.visualstudio.com/items?itemName=usernamehw.errorlens" className="hover:underline">Error Lens Extension</a>
                    <span className="text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5 dark:bg-gray-700 dark:text-gray-300">Optional</span>
                  </h2>
                  <p className="text-sm text-muted-foreground dark:text-gray-400">
                    Install the Error Lens VS Code extension for prettier diagnostic messages.
                  </p>
                </div>

                {/* Note */}
                <div className="rounded-lg border border-border bg-muted p-4 dark:border-gray-700 dark:bg-gray-800">
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
                      Trouble installing or looking for a specific customization? Please see <a href="FAQ.md" className="font-medium underline underline-offset-4">FAQ section</a>, if you are still stuck, please <a href="https://github.com/ashish10alex/vscode-dataform-tools/issues" className="font-medium underline underline-offset-4">raise an issue here</a>.
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
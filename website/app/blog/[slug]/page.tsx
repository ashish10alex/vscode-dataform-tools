import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientBlogContent } from "@/app/components/ClientBlogContent";

// This would be replaced with actual data fetching in a real implementation
const getBlogPost = async (slug: string) => {
  const posts = {
    "compiler-options": {
      title: "Using Compiler options in Dataform",
      date: "May 15, 2023",
      content: `
Compiler options can be used to set things like table prefix, schema prefix and adding variables the the query compilation or execution.

List of compiler options can be seen by running \`dataform compile --help\` in your terminal:

For example, to set the table prefix to \`AA\`, you can run:

\`\`\`bash
dataform compile --table-prefix=AA
\`\`\`


\`your-project.your-dataset.your-table\` would become \`your-project.your-dataset.AA_your-table\`

This is especially useful for organizing tables in your data warehouse or when working with multiple environments (development, staging, production).

Here is the full list of compiler options:

\`\`\`bash
❯ dataform compile --help
dataform compile [project-dir]

Compile the dataform project. Produces JSON output describing the non-executable graph.

Positionals:
  project-dir  The Dataform project directory.  [default: "."]

Options:
  --help              Show help  [boolean]
  --version           Show version number  [boolean]
  --watch             Whether to watch the changes in the project directory.  [boolean] [default: false]
  --json              Outputs a JSON representation of the compiled project.  [boolean] [default: false]
  --timeout           Duration to allow project compilation to complete. Examples: '1s', '10m', etc.  [string] [default: null]
  --default-database  The default database to use, equivalent to Google Cloud Project ID. If unset, the value from workflow_settings.yaml is used.  [string]
  --default-schema    Override for the default schema name. If unset, the value from workflow_settings.yaml is used.
  --default-location  The default location to use. See https://cloud.google.com/bigquery/docs/locations for supported values. If unset, the value from workflow_settings.yaml is used.
  --assertion-schema  Default assertion schema. If unset, the value from workflow_settings.yaml is used.
  --vars              Override for variables to inject via '--vars=someKey=someValue,a=b', referenced by \`dataform.projectConfig.vars.someValue\`.  If unset, the value from workflow_settings.yaml is used.  [string] [default: null]
  --database-suffix   Default assertion schema. If unset, the value from workflow_settings.yaml is used.
  --schema-suffix     A suffix to be appended to output schema names. If unset, the value from workflow_settings.yaml is used.
  --table-prefix      Adds a prefix for all table names. If unset, the value from workflow_settings.yaml is used.
\`\`\`
      `
    },
  };
  
  // Use type assertion to fix the TypeScript error
  return posts[slug as keyof typeof posts] || null;
};

export const generateMetadata = async ({ params }: { params: { slug: string } }): Promise<Metadata> => {
  // Await the params object before accessing its properties
  const resolvedParams = await params;
  const post = await getBlogPost(resolvedParams.slug);
  
  if (!post) {
    return {
      title: "Blog Post Not Found",
      description: "The requested blog post could not be found."
    };
  }
  
  return {
    title: post.title,
    description: `${post.title} - Published on ${post.date}`
  };
};

export default async function BlogPostPage({ params }: { params: { slug: string } }) {
  // Await the params object before accessing its properties
  const resolvedParams = await params;
  const post = await getBlogPost(resolvedParams.slug);
  
  if (!post) {
    notFound();
  }
  
  return (
    <div className="py-12 px-8 w-full max-w-[95%] mx-auto">
      <Link 
        href="/blog" 
        className="text-primary hover:underline mb-6 inline-flex items-center"
      >
        ← Back to Blog
      </Link>
      
      <article className="prose prose-lg dark:prose-invert max-w-none mt-6">
        <h1>{post.title}</h1>
        <div className="text-sm text-muted-foreground mb-8">
          Published on {post.date}
        </div>
        
        <ClientBlogContent content={post.content} />
      </article>
    </div>
  );
} 
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog",
};

export default function BlogPage() {
  return (
    <div className="container py-12 max-w-screen-lg">
      <div className="space-y-4 pl-10">
        <h1 className="text-4xl font-bold tracking-tighter">Blogs</h1>
      </div>

      <div className="grid gap-8 mt-12 pl-10">
        <BlogPostCard
          title="Using Compiler options in Dataform"
          description="Learn how to use compiler options in Dataform to set things like table prefix, schema prefix and adding variables the the query compilation or execution."
          date="April 16, 2025"
          slug="compiler-options"
        />
      </div>
    </div>
  );
}

function BlogPostCard({ title, description, date, slug }: { title: string, description: string, date: string, slug: string }) {
  return (
    <div className="group border border-border rounded-lg p-6 transition-all hover:border-primary hover:shadow-md">
      <div className="space-y-2">
        <div className="text-sm text-muted-foreground">{date}</div>
        <h2 className="text-2xl font-bold group-hover:text-primary transition-colors">
          {title}
        </h2>
        <p className="text-muted-foreground">{description}</p>
        <a
          href={`/blog/${slug}`}
          className="inline-block text-primary font-medium mt-4 hover:underline"
        >
          Read more →
        </a>
      </div>
    </div>
  );
}

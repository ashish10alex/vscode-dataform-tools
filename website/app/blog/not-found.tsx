import Link from "next/link";

export default function BlogNotFound() {
  return (
    <div className="container py-12 max-w-screen-md text-center">
      <h1 className="text-4xl font-bold tracking-tighter mb-4">Blog Post Not Found</h1>
      <p className="text-muted-foreground text-lg mb-8">
        Sorry, the blog post you're looking for doesn't exist or has been moved.
      </p>
      <Link 
        href="/blog" 
        className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
      >
        Back to Blog
      </Link>
    </div>
  );
} 
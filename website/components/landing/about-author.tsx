import { Github, Linkedin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getReleaseStats } from "@/lib/changelog";
import { site } from "@/lib/site";

export function AboutAuthor() {
  const { count } = getReleaseStats();

  return (
    <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6 md:mt-24">
      <div className="grid gap-8 rounded-2xl border bg-card p-6 sm:p-10 md:grid-cols-[auto_1fr] md:gap-10">
        <img
          src={site.author.avatar}
          alt={site.author.name}
          width={96}
          height={96}
          loading="lazy"
          className="h-20 w-20 rounded-full border sm:h-24 sm:w-24"
        />
        <div>
          <p className="font-mono text-xs text-brand">-- about the author</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Built by {site.author.name}</h2>
          {/* DRAFT copy — written from the project's git history; edit freely. */}
          <div className="mt-4 max-w-2xl space-y-3 text-muted-foreground">
            <p>
              I started Dataform Tools in May 2024 with a single feature: showing Dataform compilation errors directly
              on the <code>.sqlx</code> line I was editing. It has grown one release at a time since then, to {count}{" "}
              releases and counting, shaped by issues and ideas from the people who use it every day.
            </p>
            <p>
              It&apos;s open source and maintained independently. If something is missing or broken, please open an
              issue.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={site.author.github} target="_blank" rel="noopener noreferrer">
                <Github /> GitHub
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={site.author.linkedin} target="_blank" rel="noopener noreferrer">
                <Linkedin /> LinkedIn
              </a>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href={`${site.repoUrl}/issues`} target="_blank" rel="noopener noreferrer">
                Open an issue
              </a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

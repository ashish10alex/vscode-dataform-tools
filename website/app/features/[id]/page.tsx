import { notFound } from "next/navigation"
import FeatureDetail from "@/components/feature-detail"

interface Feature {
  id: string
  title: string
  description: string
  videoUrl: string
  thumbnail: string
  longDescription?: string
}

// This would typically come from a CMS or API
const features: Feature[] = [
  {
    id: "compile-sql",
    title: "Compile SQL",
    description: "Compile your SQLX files to SQL with a single click. View the compiled SQL directly in VSCode.",
    videoUrl: "/placeholder.svg?height=400&width=600",
    thumbnail: "/placeholder.svg?height=400&width=600",
    longDescription: `
      <h2>How SQL Compilation Works</h2>
      <p>The Compile SQL feature allows you to transform your SQLX files into pure SQL with a single click. This is particularly useful when you want to:</p>
      <ul>
        <li>Debug your Dataform code</li>
        <li>Share SQL with team members who don't use Dataform</li>
        <li>Run queries directly in your data warehouse</li>
      </ul>
      <p>Simply right-click on any SQLX file in your project and select "Compile to SQL" from the context menu.</p>
    `,
  },
  {
    id: "schema-explorer",
    title: "Schema Explorer",
    description: "Explore your project's schema, including tables, views, and their relationships.",
    videoUrl: "/placeholder.svg?height=400&width=600",
    thumbnail: "/placeholder.svg?height=400&width=600",
    longDescription: `
      <h2>Navigating Your Data Schema</h2>
      <p>The Schema Explorer provides a visual representation of your project's data model, making it easy to understand the structure of your data warehouse.</p>
      <p>Key features include:</p>
      <ul>
        <li>Tree view of all schemas, tables, and views</li>
        <li>Column details including data types</li>
        <li>Quick navigation to referenced tables</li>
        <li>Search functionality to find specific objects</li>
      </ul>
    `,
  },
  {
    id: "dependency-graph",
    title: "Dependency Graph",
    description: "Visualize dependencies between your Dataform objects with an interactive graph.",
    videoUrl: "/placeholder.svg?height=400&width=600",
    thumbnail: "/placeholder.svg?height=400&width=600",
  },
  {
    id: "code-snippets",
    title: "Code Snippets",
    description: "Use built-in snippets to quickly create common Dataform patterns and structures.",
    videoUrl: "/placeholder.svg?height=400&width=600",
    thumbnail: "/placeholder.svg?height=400&width=600",
  },
  {
    id: "syntax-highlighting",
    title: "Syntax Highlighting",
    description: "Enhanced syntax highlighting for SQLX files with Dataform-specific keywords.",
    videoUrl: "/placeholder.svg?height=400&width=600",
    thumbnail: "/placeholder.svg?height=400&width=600",
  },
  {
    id: "auto-completion",
    title: "Auto-completion",
    description: "Intelligent auto-completion for Dataform JavaScript API and SQL keywords.",
    videoUrl: "/placeholder.svg?height=400&width=600",
    thumbnail: "/placeholder.svg?height=400&width=600",
  },
]

export default function FeaturePage({ params }: { params: { id: string } }) {
  const feature = features.find((f) => f.id === params.id)

  if (!feature) {
    notFound()
  }

  return <FeatureDetail {...feature} />
}

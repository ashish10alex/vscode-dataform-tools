import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

const routes = ["", "/features", "/changelog", "/install", "/blog", "/blog/compiler-options", "/faq"];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({ url: `${site.url}${route}` }));
}

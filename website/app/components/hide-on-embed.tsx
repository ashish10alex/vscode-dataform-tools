"use client";

import { usePathname } from "next/navigation";

/** Leaves the site's chrome off /embed, which other sites show in an iframe */
export function HideOnEmbed({ children }: { children: React.ReactNode }) {
  return usePathname() === "/embed" ? null : children;
}

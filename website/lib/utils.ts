import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** "2026-09-20" → "Sep 20, 2026" (UTC, so build machines agree). */
export function formatReleaseDate(isoDate: string) {
  return new Date(isoDate).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

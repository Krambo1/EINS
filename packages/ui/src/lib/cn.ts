import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes while respecting conflicts.
 * Re-exported from '@eins/ui/cn' for zero-dep usage in apps.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

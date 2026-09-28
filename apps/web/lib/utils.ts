import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes, later ones winning, the way shadcn/ui components expect. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

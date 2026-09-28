import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-surface-2 text-text-muted',
        primary: 'border-primary/50 bg-primary-soft text-[#8fc1ef]',
        live: 'border-live/40 bg-live-soft text-live',
        success: 'border-success/40 bg-success-soft text-success',
        warning: 'border-warning/40 bg-warning-soft text-warning',
        danger: 'border-danger/40 bg-danger-soft text-[#ff8a8e]',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { badgeVariants };

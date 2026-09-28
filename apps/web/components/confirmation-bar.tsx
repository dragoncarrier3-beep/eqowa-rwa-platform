import { cn } from '@/lib/utils';

/** Deposit depth towards the 12-block mint gate. */
export function ConfirmationBar({
  current,
  required,
  className,
}: {
  current: number;
  required: number;
  className?: string;
}) {
  const percent = required > 0 ? Math.round((Math.min(current, required) / required) * 100) : 0;
  const done = current >= required;
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-text-muted">Confirmations</span>
        <span className="font-mono text-text">
          {current} <span className="text-text-faint">/ {required}</span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Block confirmations"
        aria-valuemin={0}
        aria-valuemax={required}
        aria-valuenow={Math.min(current, required)}
        className="h-1.5 overflow-hidden rounded-full bg-surface-3"
      >
        <div className={cn('h-full', done ? 'bg-success' : 'bg-live')} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

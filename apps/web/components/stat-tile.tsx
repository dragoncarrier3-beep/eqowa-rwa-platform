import { cn } from '@/lib/utils';

type StatTileProps = {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  /** Live chain values get the cyan treatment; everything else stays plain. */
  live?: boolean;
  className?: string;
};

export function StatTile({ label, value, unit, hint, live = false, className }: StatTileProps) {
  return (
    <div className={cn('rounded-panel border border-border bg-surface-2 px-4 py-3', className)}>
      <div className="text-xs font-medium uppercase tracking-wide text-text-faint">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={cn('font-mono text-2xl font-semibold', live ? 'live-glow text-live' : 'text-text')}>
          {value}
        </span>
        {unit ? <span className="text-sm text-text-muted">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-1 text-xs text-text-muted">{hint}</div> : null}
    </div>
  );
}

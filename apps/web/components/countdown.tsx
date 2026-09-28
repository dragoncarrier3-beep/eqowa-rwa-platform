'use client';

import { useEffect, useState } from 'react';

import { countdownText } from '@/lib/portfolio';

/** Ticks once a second until `until`, for the 15-minute quote window. */
export function Countdown({ until, label }: { until: string; label: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const expired = Date.parse(until) <= now.getTime();
  return (
    <span className="text-xs text-text-muted">
      {expired ? (
        'Quote window closed'
      ) : (
        <>
          {label} <span className="font-mono text-text">{countdownText(until, now)}</span>
        </>
      )}
    </span>
  );
}

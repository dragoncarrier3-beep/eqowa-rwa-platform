import { AlertTriangle } from 'lucide-react';

/**
 * Every legal page carries this until Eqowa's legal team supplies final wording.
 * The outline came from the client on 28 September 2026; the sentences below it
 * are placeholders, not legal advice.
 */
export function LegalDraftBanner() {
  return (
    <div
      role="note"
      className="mb-6 flex items-start gap-3 rounded-panel border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <div className="font-semibold">Draft, pending legal review</div>
        <div className="text-warning/90">
          Structure agreed with Eqowa Fintech. Final wording is to be supplied by Eqowa&apos;s legal team before launch.
        </div>
      </div>
    </div>
  );
}

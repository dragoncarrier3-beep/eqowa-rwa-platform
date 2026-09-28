import type { ReactNode } from 'react';

import { LegalDraftBanner } from '@/components/legal-draft-banner';

export type LegalSection = { heading: string; body: ReactNode };

/** Shared shell for the three legal pages, all drafts until legal review. */
export function LegalPage({ title, intro, sections }: { title: string; intro: string; sections: LegalSection[] }) {
  return (
    <article className="mx-auto max-w-3xl">
      <LegalDraftBanner />
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-text-muted">{intro}</p>
      <div className="mt-8 space-y-8">
        {sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-lg font-semibold">{section.heading}</h2>
            <div className="mt-2 space-y-2 text-sm leading-6 text-text-muted">{section.body}</div>
          </section>
        ))}
      </div>
      <p className="mt-10 text-xs text-text-faint">Last updated: draft of 28 September 2026.</p>
    </article>
  );
}

import { expect } from 'chai';

import { applyExceptionResolution } from '../../config/exceptions';

describe('exception queue', () => {
  const now = new Date('2026-09-16T12:00:00.000Z');
  const open = {
    id: 'ex-1',
    kind: 'amount_mismatch',
    intentId: 'intent-1',
    status: 'open' as const,
    details: { quotedAmount: '10' },
    createdAt: now,
  };

  it('resolves an open exception once', () => {
    const first = applyExceptionResolution(open, { actor: 'ops', resolution: 'manual refund', now });
    expect(first).to.have.property('record');
    if ('record' in first) {
      expect(first.record.status).to.equal('resolved');
      expect(first.record.resolvedBy).to.equal('ops');
      expect(applyExceptionResolution(first.record, { actor: 'ops', resolution: 'again', now })).to.deep.equal({
        error: 'already_resolved',
      });
    }
  });

  it('rejects a blank resolution', () => {
    expect(applyExceptionResolution(open, { actor: 'ops', resolution: '   ', now })).to.deep.equal({
      error: 'empty_resolution',
    });
  });
});

import React from 'react';
import { Layers } from 'lucide-react';
import type { CaseHit } from '../../types';

interface CaseHitsListProps {
  hits: CaseHit[];
  onSelectAccount: (accountId: string) => void;
}

export const CaseHitsList: React.FC<CaseHitsListProps> = ({ hits, onSelectAccount }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
        Clustered Detector Hits ({hits.length})
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '320px', overflowY: 'auto' }}>
        {hits.map((hit, idx) => {
          const measurements = Object.entries(hit.measurements || {}).filter(
            ([k]) => k !== 'account_ids' && k !== 'transaction_ids'
          );

          return (
            <div
              key={hit.hit_id || idx}
              className="rt-card"
              style={{
                padding: '0.85rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                borderLeft: '3px solid var(--brand-forest)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Layers size={14} color="var(--brand-forest)" />
                  <span className="rt-badge rt-badge-emerald" style={{ fontSize: '0.7rem' }}>
                    {hit.pattern.replace('_', '-')}
                  </span>
                  <span className="mono" style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                    {hit.hit_id}
                  </span>
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {hit.account_ids?.length || 0} accounts · {hit.tx_ids?.length || 0} transactions
                </div>
              </div>

              {hit.explanation ? (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-primary)', margin: 0, lineHeight: 1.45 }}>
                  {hit.explanation}
                </p>
              ) : null}

              {/* Measurement Metrics Grid */}
              {measurements.length > 0 ? (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                    gap: '0.4rem',
                    backgroundColor: 'var(--surface-secondary)',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  {measurements.map(([key, val]) => (
                    <div key={key} style={{ display: 'flex', flexDirection: 'column', fontSize: '0.675rem' }}>
                      <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                        {key.replace(/_/g, ' ')}
                      </span>
                      <span className="mono" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {typeof val === 'boolean' ? (val ? 'Yes' : 'No') : typeof val === 'number' ? (Number.isInteger(val) ? val : val.toFixed(2)) : String(val ?? '—')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Involved Accounts Pills */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>Accounts:</span>
                {(hit.account_ids || []).map((accId) => (
                  <button
                    key={accId}
                    onClick={() => onSelectAccount(accId)}
                    className="mono"
                    style={{
                      background: 'var(--surface-muted)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '4px',
                      padding: '1px 5px',
                      fontSize: '0.675rem',
                      color: 'var(--accent-blue)',
                      cursor: 'pointer',
                    }}
                  >
                    {accId}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

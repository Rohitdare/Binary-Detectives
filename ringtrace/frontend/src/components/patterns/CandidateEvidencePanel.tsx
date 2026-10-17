import React from 'react';
import { Copy, Check, ArrowRight, X } from 'lucide-react';
import type { DetectorTransaction } from '../../types';
import type { WorkbenchCandidate } from './types';
import { currency, formatDateTime, formatDuration } from './candidateUtils';

interface CandidateEvidencePanelProps {
  candidate: WorkbenchCandidate;
  selectedTx: DetectorTransaction | null;
  onSelectTx: (tx: DetectorTransaction | null) => void;
  onInspectAccount: (accountId: string) => void;
}

export const CandidateEvidencePanel: React.FC<CandidateEvidencePanelProps> = ({
  candidate,
  selectedTx,
  onSelectTx,
  onInspectAccount,
}) => {
  const [copiedId, setCopiedId] = React.useState(false);

  const handleCopyId = () => {
    void navigator.clipboard.writeText(candidate.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const measureEntries = Object.entries(candidate.measurements).filter(
    ([key]) => key !== 'suspicious' && key !== 'transaction_ids' && key !== 'account_ids'
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      {/* Evidence Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '0.6rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            className={`rt-badge ${candidate.suspicious ? 'rt-badge-amber' : 'rt-badge-gray'}`}
            style={{ fontSize: '0.675rem' }}
          >
            {candidate.suspicious ? 'Flagged for Review' : 'Pattern Candidate'}
          </span>
          <span className="mono" style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
            {candidate.id}
          </span>
          <button
            onClick={handleCopyId}
            className="rt-button rt-button-sm"
            style={{ padding: '0.15rem 0.35rem', border: 'none', background: 'transparent' }}
            title="Copy candidate ID"
          >
            {copiedId ? <Check size={11} color="var(--brand-teal)" /> : <Copy size={11} />}
          </button>
        </div>

        <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
          {candidate.accounts.length} entities · {candidate.transactions.length} transfers
        </span>
      </div>

      {/* Pattern Explanation */}
      <div>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
          Typology Findings
        </div>
        <p
          style={{
            fontSize: '0.775rem',
            lineHeight: 1.5,
            color: 'var(--text-secondary)',
            margin: 0,
            backgroundColor: 'var(--surface-secondary)',
            padding: '0.65rem 0.85rem',
            borderRadius: '6px',
            border: '1px solid var(--border-subtle)',
          }}
        >
          {candidate.explanation}
        </p>
      </div>

      {/* Structured Measurements Grid */}
      {measureEntries.length > 0 && (
        <div>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
            Detector Metrics
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '0.45rem',
            }}
          >
            {measureEntries.map(([key, val]) => {
              let displayVal = String(val);
              if (typeof val === 'number') {
                if (key.includes('density') || key.includes('ratio') || key === 'retention' || key.includes('share')) {
                  displayVal = `${(val * 100).toFixed(1)}%`;
                } else if (key.includes('z_score')) {
                  displayVal = `${val.toFixed(2)}σ`;
                } else if (key.includes('amount') || key.includes('flow')) {
                  displayVal = currency.format(val);
                } else if (key.includes('duration') || key.includes('window') || key.includes('seconds')) {
                  displayVal = formatDuration(val);
                } else {
                  displayVal = val.toLocaleString();
                }
              }

              return (
                <div
                  key={key}
                  style={{
                    padding: '0.45rem 0.65rem',
                    backgroundColor: 'var(--surface-secondary)',
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.65rem',
                      color: 'var(--text-muted)',
                      textTransform: 'capitalize',
                      marginBottom: '0.15rem',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={key.replaceAll('_', ' ')}
                  >
                    {key.replaceAll('_', ' ')}
                  </div>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {displayVal}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected Transaction Callout */}
      {selectedTx && (
        <div
          style={{
            backgroundColor: 'var(--accent-amber-subtle)',
            border: '1px solid var(--accent-amber-border)',
            borderRadius: '6px',
            padding: '0.65rem 0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}
        >
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent-amber)' }}>
              Selected Edge Transfer · {selectedTx.tx_id}
            </div>
            <div style={{ fontSize: '0.775rem', fontWeight: 600, marginTop: '0.2rem', color: 'var(--text-primary)' }}>
              <span className="mono">{selectedTx.src}</span> → <span className="mono">{selectedTx.dst}</span> ·{' '}
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{currency.format(selectedTx.amount)}</span>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
              {formatDateTime(selectedTx.ts)} · {selectedTx.tx_type}
            </div>
          </div>
          <button
            onClick={() => onSelectTx(null)}
            className="rt-button rt-button-sm"
            style={{ padding: '0.2rem', background: 'transparent', border: 'none' }}
            title="Deselect edge"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Supporting Transfers Ledger Table */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '0.35rem',
          }}
        >
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Supporting Transaction Ledger ({candidate.transactions.length})
          </span>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            Click row to highlight edge
          </span>
        </div>

        <div style={{ overflowX: 'auto', maxHeight: '280px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
          <table className="rt-table" style={{ margin: 0, fontSize: '0.725rem' }}>
            <thead>
              <tr>
                <th style={{ padding: '0.45rem 0.65rem' }}>Flow</th>
                <th style={{ padding: '0.45rem 0.65rem' }}>Channel</th>
                <th style={{ padding: '0.45rem 0.65rem' }}>Timestamp</th>
                <th style={{ padding: '0.45rem 0.65rem', textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {candidate.transactions.map((tx) => {
                const isSelected = selectedTx?.tx_id === tx.tx_id;
                return (
                  <tr
                    key={tx.tx_id}
                    onClick={() => onSelectTx(isSelected ? null : tx)}
                    style={{
                      cursor: 'pointer',
                      backgroundColor: isSelected ? 'var(--accent-amber-subtle)' : undefined,
                    }}
                  >
                    <td style={{ padding: '0.45rem 0.65rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <button
                          type="button"
                          className="account-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            onInspectAccount(tx.src);
                          }}
                          title={`Inspect ${tx.src}`}
                        >
                          {tx.src}
                        </button>
                        <ArrowRight size={10} color="var(--text-muted)" />
                        <button
                          type="button"
                          className="account-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            onInspectAccount(tx.dst);
                          }}
                          title={`Inspect ${tx.dst}`}
                        >
                          {tx.dst}
                        </button>
                      </div>
                      <div className="mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        {tx.tx_id}
                      </div>
                    </td>
                    <td style={{ padding: '0.45rem 0.65rem', color: 'var(--text-secondary)' }}>
                      {tx.tx_type}
                    </td>
                    <td style={{ padding: '0.45rem 0.65rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {formatDateTime(tx.ts)}
                    </td>
                    <td style={{ padding: '0.45rem 0.65rem', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {currency.format(tx.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

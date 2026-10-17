import React, { useEffect, useState, useCallback } from 'react';
import {
  BrainCircuit,
  History,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Clock
} from 'lucide-react';
import { ringtraceApi } from '../../services/api';
import type { SimilarCaseItem } from '../../types';

export interface MemoryPanelProps {
  caseId: string;
  onSelectCase?: (caseId: string) => void;
  onSimilarCasesLoaded?: (items: SimilarCaseItem[]) => void;
  refreshTrigger?: number;
}

/**
 * MemoryPanel displays historical precedents and memory recall from FalkorDB.
 * e.g., "Similar Case #CASE_0003 was dismissed as benign payroll last month"
 */
export const MemoryPanel: React.FC<MemoryPanelProps> = ({
  caseId,
  onSelectCase = () => {},
  onSimilarCasesLoaded,
  refreshTrigger = 0,
}) => {
  const [similarCases, setSimilarCases] = useState<SimilarCaseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSimilar = useCallback(async () => {
    if (!caseId) {
      setSimilarCases([]);
      onSimilarCasesLoaded?.([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await ringtraceApi.getSimilarCases(caseId, 5);
      const items = res.items || [];
      setSimilarCases(items);
      onSimilarCasesLoaded?.(items);
    } catch (err: any) {
      setError(err?.message || 'Failed to query memory graph precedents.');
      setSimilarCases([]);
      onSimilarCasesLoaded?.([]);
    } finally {
      setLoading(false);
    }
  }, [caseId, onSimilarCasesLoaded]);

  useEffect(() => {
    fetchSimilar();
  }, [fetchSimilar, refreshTrigger]);

  const renderOutcomeBadge = (outcome?: string | null) => {
    const norm = (outcome || '').toLowerCase();
    if (norm === 'dismissed' || norm === 'dismiss') {
      return (
        <span className="rt-badge rt-badge-emerald" style={{ fontSize: '0.7rem' }}>
          <ShieldCheck size={11} />
          Dismissed (Benign)
        </span>
      );
    }
    if (norm === 'escalated' || norm === 'escalate' || norm === 'sar_drafted') {
      return (
        <span className="rt-badge rt-badge-rose" style={{ fontSize: '0.7rem' }}>
          <ShieldAlert size={11} />
          {norm === 'sar_drafted' ? 'SAR Drafted' : 'Escalated (SAR)'}
        </span>
      );
    }
    if (norm === 'monitoring' || norm === 'monitor') {
      return (
        <span className="rt-badge rt-badge-amber" style={{ fontSize: '0.7rem' }}>
          <Clock size={11} />
          Monitoring
        </span>
      );
    }
    return (
      <span className="rt-badge badge-personal" style={{ fontSize: '0.7rem' }}>
        {outcome || 'Open'}
      </span>
    );
  };

  return (
    <div className="rt-card" style={{ padding: '1.25rem', flex: '1 1 320px', minWidth: '300px', border: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ padding: '0.35rem', borderRadius: '6px', backgroundColor: 'var(--brand-mint-subtle)', color: 'var(--brand-forest)' }}>
            <BrainCircuit size={17} />
          </div>
          <div>
            <h3 style={{ fontSize: '0.925rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span>Memory & Past Precedents</span>
              {similarCases.length > 0 && (
                <span className="rt-badge rt-badge-mint mono" style={{ fontSize: '0.675rem', padding: '1px 6px' }}>
                  {similarCases.length}
                </span>
              )}
            </h3>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-secondary)' }}>
              FalkorDB Memory Graph Recall
            </div>
          </div>
        </div>

        <button
          onClick={fetchSimilar}
          disabled={loading || !caseId}
          className="rt-button rt-button-sm"
          title="Refresh Precedents"
        >
          <RefreshCw size={12} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          <RefreshCw size={18} className="spin" style={{ margin: '0 auto 0.5rem' }} />
          Querying past decided cases in memory...
        </div>
      ) : error ? (
        <div style={{ padding: '0.85rem', backgroundColor: 'var(--accent-red-subtle)', borderRadius: '6px', color: 'var(--accent-red)', fontSize: '0.775rem', border: '1px solid var(--accent-red-border)' }}>
          <AlertTriangle size={14} style={{ display: 'inline', marginRight: '0.4rem', verticalAlign: 'text-bottom' }} />
          {error}
        </div>
      ) : similarCases.length === 0 ? (
        <div style={{
          padding: '1.75rem 1rem',
          textAlign: 'center',
          backgroundColor: 'var(--surface-secondary)',
          borderRadius: '8px',
          border: '1px dashed var(--border-medium)',
          fontSize: '0.775rem',
          color: 'var(--text-muted)'
        }}>
          <History size={22} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
          <div>No prior decided cases matched this topology yet.</div>
          <div style={{ fontSize: '0.7rem', marginTop: '0.25rem', color: 'var(--text-secondary)' }}>
            When an analyst records a decision, it permanently persists to the memory graph.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {similarCases.map((item, idx) => {
            const hasSharedAcc = item.shared_account_ids && item.shared_account_ids.length > 0;
            const isDismissed = (item.outcome || '').toLowerCase().includes('dismiss');
            return (
              <div
                key={item.case_id || idx}
                style={{
                  padding: '0.75rem 0.85rem',
                  borderRadius: '6px',
                  backgroundColor: 'var(--surface-secondary)',
                  border: '1px solid var(--border-subtle)',
                  transition: 'border-color 0.15s ease',
                  fontSize: '0.775rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <span className="mono" style={{ fontWeight: 600, color: 'var(--brand-teal)' }}>
                      {item.case_id}
                    </span>
                    <button
                      onClick={() => onSelectCase(item.case_id)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                      title="Inspect this case"
                    >
                      <ExternalLink size={12} />
                    </button>
                  </div>
                  {renderOutcomeBadge(item.outcome)}
                </div>

                {/* Precedent Narrative Highlight */}
                <div style={{
                  color: isDismissed ? 'var(--accent-green)' : 'var(--text-primary)',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  marginBottom: '0.35rem',
                  lineHeight: 1.35
                }}>
                  {isDismissed ? (
                    <span>
                      Prior Precedent: Similar case <span className="mono">{item.case_id}</span> was <strong>dismissed as benign</strong>.
                    </span>
                  ) : (
                    <span>
                      Prior Precedent: Matched case <span className="mono">{item.case_id}</span> resulted in <strong>{item.outcome}</strong>.
                    </span>
                  )}
                </div>

                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                  <div>
                    Match Signature: <span style={{ color: 'var(--text-secondary)' }}>{item.match}</span>
                  </div>
                  {hasSharedAcc && (
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      Shared Accounts: <span className="mono" style={{ color: 'var(--text-secondary)' }}>{item.shared_account_ids.join(', ')}</span>
                    </div>
                  )}
                  {item.decided_at && (
                    <div>
                      Decided: <span style={{ color: 'var(--text-secondary)' }}>{new Date(item.decided_at).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MemoryPanel;

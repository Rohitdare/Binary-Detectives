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
  refreshTrigger?: number;
}

/**
 * MemoryPanel displays historical precedents and memory recall from FalkorDB.
 * e.g., "Similar Case #CASE_0003 was dismissed as benign payroll last month"
 */
export const MemoryPanel: React.FC<MemoryPanelProps> = ({
  caseId,
  onSelectCase = () => {},
  refreshTrigger = 0,
}) => {
  const [similarCases, setSimilarCases] = useState<SimilarCaseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSimilar = useCallback(async () => {
    if (!caseId) {
      setSimilarCases([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await ringtraceApi.getSimilarCases(caseId, 5);
      setSimilarCases(res.items || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to query memory graph precedents.');
      setSimilarCases([]);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    fetchSimilar();
  }, [fetchSimilar, refreshTrigger]);

  const renderOutcomeBadge = (outcome?: string | null) => {
    const norm = (outcome || '').toLowerCase();
    if (norm === 'dismissed' || norm === 'dismiss') {
      return (
        <span className="rt-badge badge-success" style={{ fontSize: '0.7rem' }}>
          <ShieldCheck size={11} />
          Dismissed (Benign)
        </span>
      );
    }
    if (norm === 'escalated' || norm === 'escalate' || norm === 'sar_drafted') {
      return (
        <span className="rt-badge badge-danger" style={{ fontSize: '0.7rem' }}>
          <ShieldAlert size={11} />
          {norm === 'sar_drafted' ? 'SAR Drafted' : 'Escalated (SAR)'}
        </span>
      );
    }
    if (norm === 'monitoring' || norm === 'monitor') {
      return (
        <span className="rt-badge badge-warning" style={{ fontSize: '0.7rem' }}>
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
    <div className="rt-card" style={{ flex: '1 1 320px', minWidth: '300px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ padding: '0.35rem', borderRadius: '6px', backgroundColor: 'rgba(168, 85, 247, 0.15)', color: 'var(--accent-purple)' }}>
            <BrainCircuit size={17} />
          </div>
          <div>
            <h3 style={{ fontSize: '0.925rem', fontWeight: 600 }}>Memory & Past Precedents</h3>
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
        <div style={{ padding: '0.85rem', backgroundColor: 'rgba(244, 63, 94, 0.1)', borderRadius: '6px', color: 'var(--accent-rose)', fontSize: '0.775rem' }}>
          <AlertTriangle size={14} style={{ display: 'inline', marginRight: '0.4rem', verticalAlign: 'text-bottom' }} />
          {error}
        </div>
      ) : similarCases.length === 0 ? (
        <div style={{
          padding: '1.75rem 1rem',
          textAlign: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.15)',
          borderRadius: '6px',
          border: '1px dashed var(--border-subtle)',
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
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border-subtle)',
                  transition: 'border-color 0.15s ease',
                  fontSize: '0.775rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <span className="mono" style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>
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
                  color: isDismissed ? 'var(--accent-emerald)' : 'var(--text-primary)',
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

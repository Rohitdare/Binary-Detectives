import React, { useState } from 'react';
import { Search, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import type { CaseRecord } from '../../types';

interface CaseQueueListProps {
  cases: CaseRecord[];
  selectedCaseId: string | null;
  onSelectCase: (caseId: string) => void;
  loading: boolean;
  isScanning: boolean;
  scanProgress: string | null;
  onTriggerScan: () => void;
  onRefresh: () => void;
  filterStatus: string;
  setFilterStatus: (s: string) => void;
  filterSeverity: string;
  setFilterSeverity: (s: string) => void;
  filterPattern: string;
  setFilterPattern: (s: string) => void;
  sortBy: string;
  setSortBy: (s: string) => void;
}

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const PATTERN_OPTIONS = [
  { value: '', label: 'All Patterns' },
  { value: 'cycle', label: 'Cycle' },
  { value: 'fan_in', label: 'Fan-In' },
  { value: 'fan_out', label: 'Fan-Out' },
  { value: 'relay_chain', label: 'Relay Chain' },
  { value: 'scatter_gather', label: 'Scatter-Gather' },
  { value: 'gather_scatter', label: 'Gather-Scatter' },
  { value: 'bipartite', label: 'Bipartite' },
  { value: 'dense_cluster', label: 'Dense Cluster' },
  { value: 'hub_account', label: 'Hub Account' },
];

export const CaseQueueList: React.FC<CaseQueueListProps> = ({
  cases,
  selectedCaseId,
  onSelectCase,
  loading,
  isScanning,
  scanProgress,
  onTriggerScan,
  onRefresh,
  filterStatus,
  setFilterStatus,
  filterSeverity,
  setFilterSeverity,
  filterPattern,
  setFilterPattern,
  sortBy,
  setSortBy,
}) => {
  const [search, setSearch] = useState('');

  const filteredCases = cases.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.case_id.toLowerCase().includes(q) ||
      c.patterns.some((p) => p.toLowerCase().includes(q))
    );
  });

  const getScoreColor = (score: number) => {
    if (score >= 70) return '#EF4444'; // high
    if (score >= 40) return '#F59E0B'; // medium
    return '#64748B'; // low
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', height: '100%' }}>
      {/* Action Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <div>
          <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Case Queue ({filteredCases.length})
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Ranked by priority score
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <button
            onClick={onRefresh}
            className="rt-button rt-button-sm"
            disabled={loading || isScanning}
            title="Refresh case list"
            style={{ padding: '0.35rem' }}
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
          <button
            onClick={onTriggerScan}
            disabled={isScanning}
            className="rt-button rt-button-primary rt-button-sm"
            style={{ gap: '0.35rem', fontSize: '0.725rem' }}
          >
            {isScanning ? (
              <>
                <RefreshCw size={12} className="spin" />
                <span>{scanProgress || 'Scanning...'}</span>
              </>
            ) : (
              <>
                <Play size={12} />
                <span>Run Scan</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Search Input */}
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: '9px', top: '9px', color: 'var(--text-muted)' }} />
        <input
          type="text"
          placeholder="Filter by case ID or pattern..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rt-input"
          style={{ width: '100%', paddingLeft: '28px', fontSize: '0.75rem', height: '32px' }}
        />
      </div>

      {/* Filter Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          className="rt-input"
          style={{ fontSize: '0.7rem', height: '28px', padding: '0 0.4rem' }}
        >
          <option value="">All Severities</option>
          <option value="high">High (&ge; 70)</option>
          <option value="medium">Medium (40–69)</option>
          <option value="low">Low (&lt; 40)</option>
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rt-input"
          style={{ fontSize: '0.7rem', height: '28px', padding: '0 0.4rem' }}
        >
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="escalated">Escalated</option>
          <option value="monitoring">Monitoring</option>
          <option value="dismissed">Dismissed</option>
          <option value="sar_drafted">SAR Drafted</option>
        </select>

        <select
          value={filterPattern}
          onChange={(e) => setFilterPattern(e.target.value)}
          className="rt-input"
          style={{ fontSize: '0.7rem', height: '28px', padding: '0 0.4rem' }}
        >
          {PATTERN_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="rt-input"
          style={{ fontSize: '0.7rem', height: '28px', padding: '0 0.4rem' }}
        >
          <option value="score">Sort by Score</option>
          <option value="updated_at">Sort by Recent</option>
        </select>
      </div>

      {/* List Container */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          overflowY: 'auto',
          maxHeight: 'calc(100vh - 280px)',
          paddingRight: '2px',
        }}
      >
        {loading && cases.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            <RefreshCw size={18} className="spin" style={{ margin: '0 auto 0.5rem' }} />
            Loading cases from memory graph...
          </div>
        ) : filteredCases.length === 0 ? (
          <div
            className="rt-card"
            style={{
              padding: '2rem 1rem',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <ShieldCheck size={28} color="var(--border-medium)" />
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              No Cases Found
            </div>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
              {cases.length === 0
                ? 'No cases currently exist. Click "Run Scan" to run the detection and grouping pipeline.'
                : 'No cases match current filter criteria.'}
            </div>
          </div>
        ) : (
          filteredCases.map((c) => {
            const isSelected = selectedCaseId === c.case_id;
            const scoreColor = getScoreColor(c.score);

            return (
              <div
                key={c.case_id}
                onClick={() => onSelectCase(c.case_id)}
                className="rt-card"
                style={{
                  padding: '0.75rem 0.85rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.45rem',
                  cursor: 'pointer',
                  borderLeft: isSelected ? '3px solid var(--brand-forest)' : '1px solid var(--border-subtle)',
                  backgroundColor: isSelected ? 'var(--surface-secondary)' : 'var(--surface-primary)',
                  boxShadow: isSelected ? 'var(--shadow-hover)' : 'var(--shadow-sm)',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="mono" style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                    {c.case_id}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span
                      style={{
                        padding: '1px 6px',
                        borderRadius: '4px',
                        backgroundColor: scoreColor,
                        color: '#FFFFFF',
                        fontSize: '0.675rem',
                        fontWeight: 700,
                      }}
                    >
                      {c.score}
                    </span>
                    <span
                      className={`rt-badge ${c.severity === 'high' ? 'rt-badge-rose' : c.severity === 'medium' ? 'rt-badge-amber' : 'rt-badge-gray'}`}
                      style={{ fontSize: '0.625rem', textTransform: 'uppercase' }}
                    >
                      {c.severity}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {c.patterns.map((p) => (
                    <span
                      key={p}
                      className="rt-badge rt-badge-emerald"
                      style={{ fontSize: '0.625rem', padding: '1px 5px' }}
                    >
                      {p.replace('_', '-')}
                    </span>
                  ))}
                  <span
                    className="rt-badge rt-badge-gray"
                    style={{ fontSize: '0.625rem', textTransform: 'capitalize' }}
                  >
                    {c.status}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                    borderTop: '1px solid var(--border-subtle)',
                    paddingTop: '0.35rem',
                    marginTop: '0.15rem',
                  }}
                >
                  <span>{c.account_count} accounts · {c.tx_count} txs</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {currency.format(c.total_amount)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

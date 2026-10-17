import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { CaseRecord } from '../../types';
import { ringtraceApi } from '../../services/api';
import {
  Search,
  RefreshCw,
  ShieldCheck,
  ArrowRight,
  Filter,
  X,
} from 'lucide-react';

interface CaseManagementViewProps {
  onSelectCase: (caseId: string) => void;
  onInspectAccount?: (accountId: string) => void;
  onLaunchAgentInvestigation?: (caseId: string) => void;
}

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const PATTERN_OPTIONS = [
  { value: '', label: 'All Typologies' },
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

export const CaseManagementView: React.FC<CaseManagementViewProps> = ({
  onSelectCase,
}) => {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [loadingCases, setLoadingCases] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterSeverity, setFilterSeverity] = useState<string>('');
  const [filterPattern, setFilterPattern] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('score');

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchCases = useCallback(async () => {
    setLoadingCases(true);
    try {
      const res = await ringtraceApi.getCases({
        status: filterStatus || undefined,
        severity: filterSeverity || undefined,
        pattern: filterPattern || undefined,
        sort: sortBy,
        limit: 100,
      });
      if (isMountedRef.current) {
        setCases(res.items || []);
      }
    } catch (err: any) {
      console.error('Failed to fetch cases:', err);
    } finally {
      if (isMountedRef.current) {
        setLoadingCases(false);
      }
    }
  }, [filterStatus, filterSeverity, filterPattern, sortBy]);

  useEffect(() => {
    void fetchCases();
  }, [fetchCases]);

  // Client-side text filter (by case ID or pattern name)
  const filteredCases = cases.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.case_id.toLowerCase().includes(q) ||
      c.patterns.some((p) => p.toLowerCase().includes(q))
    );
  });

  // Calculate real summary metrics
  const totalOpenCases = cases.filter((c) => c.status !== 'closed' && c.status !== 'dismissed').length;
  const highPriorityCases = cases.filter((c) => c.severity === 'high' || c.score >= 70).length;
  const awaitingReviewCases = cases.filter((c) => c.status === 'open' || !c.status).length;

  const getSeverityBadge = (severity: string, score: number) => {
    const isHigh = severity === 'high' || score >= 70;
    const isMed = severity === 'medium' || (score >= 40 && score < 70);

    if (isHigh) {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.2rem 0.55rem',
            borderRadius: '9999px',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            color: '#D64550',
            fontSize: '0.7rem',
            fontWeight: 700,
            textTransform: 'uppercase',
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#D64550' }} />
          HIGH
        </span>
      );
    }
    if (isMed) {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.2rem 0.55rem',
            borderRadius: '9999px',
            backgroundColor: '#FFFBEB',
            border: '1px solid #FDE68A',
            color: '#D99016',
            fontSize: '0.7rem',
            fontWeight: 700,
            textTransform: 'uppercase',
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#D99016' }} />
          MEDIUM
        </span>
      );
    }
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          padding: '0.2rem 0.55rem',
          borderRadius: '9999px',
          backgroundColor: '#ECFDF5',
          border: '1px solid #A7F3D0',
          color: '#15966A',
          fontSize: '0.7rem',
          fontWeight: 700,
          textTransform: 'uppercase',
        }}
      >
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#15966A' }} />
        LOW
      </span>
    );
  };

  const getStatusBadge = (status: string) => {
    const s = (status || 'open').toLowerCase();
    let bg = '#F8FAFC';
    let color = '#475569';
    let border = '#E7EAF1';

    if (s === 'escalated') {
      bg = '#FEF2F2';
      color = '#D64550';
      border = '#FECACA';
    } else if (s === 'monitoring') {
      bg = '#FFFBEB';
      color = '#D99016';
      border = '#FDE68A';
    } else if (s === 'dismissed') {
      bg = '#ECFDF5';
      color = '#15966A';
      border = '#A7F3D0';
    } else if (s === 'sar_drafted') {
      bg = '#F3F0FF';
      color = '#6D4AFF';
      border = '#E5DDFB';
    }

    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '0.15rem 0.55rem',
          borderRadius: '6px',
          backgroundColor: bg,
          color,
          border: `1px solid ${border}`,
          fontSize: '0.725rem',
          fontWeight: 600,
          textTransform: 'capitalize',
        }}
      >
        {status ? status.replace('_', ' ') : 'Open'}
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', maxWidth: '1440px', margin: '0 auto' }}>
      {/* 1. Page Header */}
      <div>
        <h1
          style={{
            fontSize: '1.75rem',
            fontWeight: 800,
            color: 'var(--text-primary)',
            letterSpacing: '-0.03em',
            fontFamily: 'var(--font-display)',
            margin: 0,
          }}
        >
          Case Management
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem', margin: 0 }}>
          Review and prioritize suspicious transaction activity.
        </p>
      </div>

      {/* 2. Flattened Summary Metrics (Amount Hidden) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          backgroundColor: '#FFFFFF',
          borderRadius: '10px',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
        }}
      >
        {/* Metric 1: Open Cases */}
        <div
          style={{
            padding: '1rem 1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
          }}
        >
          <span style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Open Cases
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
            <span
              style={{
                fontSize: '1.6rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                fontFamily: 'JetBrains Mono, monospace',
                letterSpacing: '-0.02em',
              }}
            >
              {totalOpenCases}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>cases</span>
          </div>
        </div>

        {/* Metric 2: High-Priority Alerts */}
        <div
          style={{
            padding: '1rem 1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
            borderLeft: '1px solid var(--border-subtle)',
          }}
        >
          <span style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            High-Priority Alerts
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
            <span
              style={{
                fontSize: '1.6rem',
                fontWeight: 700,
                color: highPriorityCases > 0 ? '#D64550' : 'var(--text-primary)',
                fontFamily: 'JetBrains Mono, monospace',
                letterSpacing: '-0.02em',
              }}
            >
              {highPriorityCases}
            </span>
            <span style={{ fontSize: '0.75rem', color: highPriorityCases > 0 ? '#D64550' : 'var(--text-muted)' }}>alerts</span>
          </div>
        </div>

        {/* Metric 3: Awaiting Review */}
        <div
          style={{
            padding: '1rem 1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
            borderLeft: '1px solid var(--border-subtle)',
          }}
        >
          <span style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Awaiting Review
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
            <span
              style={{
                fontSize: '1.6rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                fontFamily: 'JetBrains Mono, monospace',
                letterSpacing: '-0.02em',
              }}
            >
              {awaitingReviewCases}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>unassigned</span>
          </div>
        </div>
      </div>

      {/* 3. Filter Toolbar & Search */}
      <div
        className="rt-card"
        style={{
          padding: '0.85rem 1.25rem',
          backgroundColor: '#FFFFFF',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.85rem',
        }}
      >
        {/* Search */}
        <div className="rt-search-box" style={{ flex: '1 1 260px', maxWidth: '380px' }}>
          <Search size={15} />
          <input
            type="text"
            placeholder="Search by case ID or typology..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rt-input"
            style={{
              width: '100%',
              height: '36px',
              paddingRight: search ? '2rem' : '0.75rem',
            }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              style={{
                position: 'absolute',
                right: '0.65rem',
                background: 'transparent',
                border: 'none',
                color: '#94A3B8',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Dropdowns */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600 }}>
            <Filter size={13} />
            <span>Filters:</span>
          </div>

          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="rt-input"
            style={{ fontSize: '0.775rem', height: '34px', padding: '0 0.65rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}
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
            style={{ fontSize: '0.775rem', height: '34px', padding: '0 0.65rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}
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
            style={{ fontSize: '0.775rem', height: '34px', padding: '0 0.65rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}
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
            style={{ fontSize: '0.775rem', height: '34px', padding: '0 0.65rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}
          >
            <option value="score">Sort by Priority Score</option>
            <option value="updated_at">Sort by Recent Activity</option>
          </select>

          {(filterSeverity || filterStatus || filterPattern || search) && (
            <button
              onClick={() => {
                setSearch('');
                setFilterSeverity('');
                setFilterStatus('');
                setFilterPattern('');
              }}
              className="rt-button rt-button-sm"
              style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* 4. Full-Width Case Queue Table */}
      <div
        className="rt-card"
        style={{
          backgroundColor: '#FFFFFF',
          border: '1px solid var(--border-subtle)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#F8FAFC',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
              Case Investigation Queue
            </span>
            <span
              style={{
                fontSize: '0.725rem',
                fontWeight: 600,
                padding: '0.1rem 0.5rem',
                borderRadius: '9999px',
                backgroundColor: 'var(--surface-secondary)',
                color: 'var(--brand-purple)',
                border: '1px solid var(--border-accent)',
              }}
            >
              {filteredCases.length} {filteredCases.length === 1 ? 'case' : 'cases'}
            </span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Select any case row to inspect evidence graph &amp; score breakdown
          </span>
        </div>

        {loadingCases && cases.length === 0 ? (
          <div style={{ padding: '3.5rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <RefreshCw size={24} className="spin" color="var(--brand-purple)" style={{ margin: '0 auto 0.75rem' }} />
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Loading prioritized cases...
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Fetching transaction clusters from FalkorDB graph engine
            </div>
          </div>
        ) : filteredCases.length === 0 ? (
          <div
            style={{
              padding: '3.5rem 1.5rem',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                backgroundColor: 'var(--surface-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--brand-purple)',
              }}
            >
              <ShieldCheck size={24} />
            </div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              No Cases Match Criteria
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: '420px', lineHeight: 1.5 }}>
              {cases.length === 0
                ? 'No alerts currently detected in the transaction graph.'
                : 'Try adjusting your filters or search keywords to view other alert cases.'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.825rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '0.725rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '0.75rem 1.25rem', fontWeight: 650 }}>Case ID</th>
                  <th style={{ padding: '0.75rem 1rem', fontWeight: 650 }}>Severity</th>
                  <th style={{ padding: '0.75rem 1rem', fontWeight: 650 }}>Priority Score</th>
                  <th style={{ padding: '0.75rem 1rem', fontWeight: 650 }}>Typology Patterns</th>
                  <th style={{ padding: '0.75rem 1rem', fontWeight: 650 }}>Involved Entities</th>
                  <th style={{ padding: '0.75rem 1rem', fontWeight: 650 }}>Flagged Volume</th>
                  <th style={{ padding: '0.75rem 1rem', fontWeight: 650 }}>Status</th>
                  <th style={{ padding: '0.75rem 1rem', fontWeight: 650 }}>Last Updated</th>
                  <th style={{ padding: '0.75rem 1.25rem', fontWeight: 650, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredCases.map((c) => {
                  const isHigh = c.score >= 70;
                  const isMed = c.score >= 40 && c.score < 70;
                  const scoreColor = isHigh ? '#D64550' : isMed ? '#D99016' : '#15966A';

                  return (
                    <tr
                      key={c.case_id}
                      onClick={() => onSelectCase(c.case_id)}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        transition: 'background-color 0.12s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#F8FAFC';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      {/* Case ID */}
                      <td style={{ padding: '0.85rem 1.25rem' }}>
                        <span
                          className="mono"
                          style={{
                            fontWeight: 700,
                            color: 'var(--brand-purple)',
                            fontSize: '0.85rem',
                          }}
                        >
                          {c.case_id}
                        </span>
                      </td>

                      {/* Severity */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        {getSeverityBadge(c.severity, c.score)}
                      </td>

                      {/* Priority Score */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span
                            className="mono"
                            style={{
                              fontSize: '0.95rem',
                              fontWeight: 800,
                              color: scoreColor,
                              minWidth: '24px',
                            }}
                          >
                            {c.score}
                          </span>
                          <div
                            style={{
                              width: '45px',
                              height: '5px',
                              borderRadius: '3px',
                              backgroundColor: '#E7EAF1',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.min(100, Math.max(0, c.score))}%`,
                                height: '100%',
                                backgroundColor: scoreColor,
                                borderRadius: '3px',
                              }}
                            />
                          </div>
                          <span style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>/100</span>
                        </div>
                      </td>

                      {/* Detected Patterns */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem' }}>
                          {c.patterns && c.patterns.slice(0, 2).map((p) => (
                            <span
                              key={p}
                              style={{
                                padding: '0.15rem 0.5rem',
                                borderRadius: '5px',
                                backgroundColor: '#F8FAFC',
                                border: '1px solid var(--border-subtle)',
                                color: 'var(--text-secondary)',
                                fontSize: '0.725rem',
                                fontWeight: 600,
                              }}
                            >
                              {p.replace('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase())}
                            </span>
                          ))}
                          {c.patterns && c.patterns.length > 2 && (
                            <span
                              style={{
                                padding: '0.15rem 0.4rem',
                                borderRadius: '5px',
                                backgroundColor: '#F1F5F9',
                                color: 'var(--text-muted)',
                                fontSize: '0.675rem',
                                fontWeight: 600,
                              }}
                            >
                              +{c.patterns.length - 2}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Involved Accounts & Transactions */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                            {c.account_count} accounts
                          </span>
                          <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                            {c.tx_count} transactions
                          </span>
                        </div>
                      </td>

                      {/* Total Amount */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span
                          className="mono"
                          style={{
                            fontWeight: 700,
                            color: 'var(--text-primary)',
                            fontSize: '0.85rem',
                          }}
                        >
                          {currency.format(c.total_amount)}
                        </span>
                      </td>

                      {/* Status */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        {getStatusBadge(c.status)}
                      </td>

                      {/* Last Updated */}
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                          {c.updated_at ? c.updated_at.substring(0, 10) : '—'}
                        </span>
                      </td>

                      {/* Action */}
                      <td style={{ padding: '0.85rem 1.25rem', textAlign: 'right' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectCase(c.case_id);
                          }}
                          className="rt-button rt-button-sm"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            fontSize: '0.75rem',
                            fontWeight: 650,
                            color: 'var(--brand-purple)',
                            backgroundColor: 'var(--surface-secondary)',
                            borderColor: 'var(--border-accent)',
                          }}
                        >
                          <span>Investigate</span>
                          <ArrowRight size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

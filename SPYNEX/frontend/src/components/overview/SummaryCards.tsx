import React from 'react';
import { Users, ArrowLeftRight, FileSearch, ShieldAlert, Cpu } from 'lucide-react';
import type { SystemStats, DetectorPattern, DetectorRunSummary } from '../../types';

interface SummaryCardsProps {
  stats: SystemStats | null;
  loading: boolean;
  runCount: number;
  latestRun: { pattern: DetectorPattern; summary: DetectorRunSummary } | null;
}

export const SummaryCards: React.FC<SummaryCardsProps> = ({ stats, loading, runCount, latestRun }) => {
  // Radial gauge values for active graph typology engines
  const activeDetectors = 9;
  const totalTypologies = 9;
  const coveragePercent = Math.round((activeDetectors / totalTypologies) * 100); // 100%
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (coveragePercent / 100) * circumference;

  return (
    <div style={{ marginBottom: '1.75rem' }}>
      {/* Header section inspired by institutional workspace */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: '1.25rem',
        flexWrap: 'wrap',
        gap: '0.75rem'
      }}>
        <div>
          <h1 style={{
            fontSize: '1.45rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em',
            margin: 0
          }}>
            Investigation Overview
          </h1>
          <p style={{
            fontSize: '0.825rem',
            color: 'var(--text-secondary)',
            marginTop: '0.25rem',
            margin: 0
          }}>
            Real-time graph intelligence across FalkorDB transactional entities, community clusters, and planted typologies.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className="rt-badge rt-badge-emerald" style={{ fontSize: '0.725rem' }}>
            Production Graph: txn
          </span>
          <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.725rem' }}>
            Zero Ground-Truth Leakage
          </span>
        </div>
      </div>

      {/* Grid of 4 Metric Cards + 1 Radial Gauge Widget */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: '1rem'
      }}>
        {/* Total Monitored Accounts */}
        <div className="rt-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{
              fontSize: '0.725rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600
            }}>
              Monitored Accounts
            </span>
            <div style={{
              padding: '0.45rem',
              borderRadius: '8px',
              backgroundColor: 'var(--brand-mint-subtle)',
              color: 'var(--brand-forest)'
            }}>
              <Users size={16} />
            </div>
          </div>
          <div style={{
            fontSize: '1.75rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.02em'
          }}>
            {loading ? '...' : (stats?.total_accounts?.toLocaleString() ?? '—')}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Indexed nodes in <span className="mono" style={{ color: 'var(--brand-teal)', fontWeight: 600 }}>:Account</span>
          </div>
        </div>

        {/* Total Ledger Transactions */}
        <div className="rt-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{
              fontSize: '0.725rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600
            }}>
              Transactions Analyzed
            </span>
            <div style={{
              padding: '0.45rem',
              borderRadius: '8px',
              backgroundColor: 'var(--accent-blue-subtle)',
              color: 'var(--accent-blue)'
            }}>
              <ArrowLeftRight size={16} />
            </div>
          </div>
          <div style={{
            fontSize: '1.75rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.02em'
          }}>
            {loading ? '...' : (stats?.total_transactions?.toLocaleString() ?? '—')}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Directed <span className="mono" style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>[:SENT]</span> payment edges
          </div>
        </div>

        {/* Detection Engine Runs */}
        <div className="rt-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{
              fontSize: '0.725rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600
            }}>
              Detection Executions
            </span>
            <div style={{
              padding: '0.45rem',
              borderRadius: '8px',
              backgroundColor: 'var(--surface-muted)',
              color: 'var(--text-secondary)'
            }}>
              <FileSearch size={16} />
            </div>
          </div>
          <div style={{
            fontSize: '1.75rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.02em'
          }}>
            {runCount}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {latestRun
              ? `${latestRun.pattern.replace('_', '-')} · ${latestRun.summary.status}`
              : 'Standby · Ready to scan'}
          </div>
        </div>

        {/* Suspicious Triage Candidates */}
        <div className="rt-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{
              fontSize: '0.725rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600
            }}>
              Flagged Suspicious
            </span>
            <div style={{
              padding: '0.45rem',
              borderRadius: '8px',
              backgroundColor: 'var(--accent-amber-subtle)',
              color: 'var(--accent-amber)'
            }}>
              <ShieldAlert size={16} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.65rem' }}>
            <span style={{
              fontSize: '1.75rem',
              fontWeight: 700,
              color: latestRun?.summary.status === 'completed' ? 'var(--accent-amber)' : 'var(--text-primary)',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.02em'
            }}>
              {latestRun?.summary.status === 'completed' ? latestRun.summary.suspicious : 0}
            </span>
            <span className={`rt-badge ${latestRun?.summary.status === 'completed' && latestRun.summary.suspicious > 0 ? 'badge-warning' : 'badge-personal'}`} style={{ fontSize: '0.7rem' }}>
              {latestRun?.summary.status === 'completed' ? `${latestRun.summary.hits} hits` : 'Awaiting Scan'}
            </span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {latestRun?.summary.status === 'completed'
              ? `${latestRun.pattern.replace('_', '-')} triage completed`
              : 'Execute detector to evaluate'}
          </div>
        </div>

        {/* Radial Gauge Card (Inspired by AeuxGlobal reference widget) */}
        <div className="rt-card" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          padding: '1rem 1.25rem',
          background: 'linear-gradient(135deg, #FFFFFF 0%, #F8FAF9 100%)'
        }}>
          {/* Circular SVG Gauge */}
          <div style={{ position: 'relative', width: '74px', height: '74px', flexShrink: 0 }}>
            <svg width="74" height="74" viewBox="0 0 74 74" style={{ transform: 'rotate(-90deg)' }}>
              {/* Background circle track */}
              <circle
                cx="37"
                cy="37"
                r={radius}
                stroke="var(--border-subtle)"
                strokeWidth="6"
                fill="transparent"
              />
              {/* Active progress stroke */}
              <circle
                cx="37"
                cy="37"
                r={radius}
                stroke="#123F37"
                strokeWidth="6"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
                style={{ transition: 'stroke-dashoffset 0.8s ease' }}
              />
            </svg>
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none'
            }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--brand-forest)', fontVariantNumeric: 'tabular-nums' }}>
                {coveragePercent}%
              </span>
            </div>
          </div>

          <div style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.2rem' }}>
              <Cpu size={13} color="var(--brand-teal)" />
              <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                Typology Coverage
              </span>
            </div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              9 of 9 Operational
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--brand-forest)', marginTop: '0.15rem', fontWeight: 600 }}>
              All 9 Graph Engines Live
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { Users, ArrowLeftRight, FileSearch, ShieldAlert } from 'lucide-react';
import type { SystemStats } from '../../types';
import type { DetectorPattern, DetectorRunSummary } from '../../types';

interface SummaryCardsProps {
  stats: SystemStats | null;
  loading: boolean;
  runCount: number;
  latestRun: { pattern: DetectorPattern; summary: DetectorRunSummary } | null;
}

export const SummaryCards: React.FC<SummaryCardsProps> = ({ stats, loading, runCount, latestRun }) => {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      gap: '1rem',
      marginBottom: '1.5rem'
    }}>
      {/* Total Accounts */}
      <div className="rt-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            Total Accounts
          </span>
          <div style={{ padding: '0.4rem', borderRadius: '6px', background: 'var(--accent-cyan-subtle)', color: 'var(--accent-cyan)' }}>
            <Users size={16} />
          </div>
        </div>
        <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          {loading ? '...' : (stats?.total_accounts?.toLocaleString() ?? '—')}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          Indexed in <span className="mono" style={{ color: 'var(--accent-cyan)' }}>txn</span> graph
        </div>
      </div>

      {/* Total Transactions */}
      <div className="rt-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            Total Transactions
          </span>
          <div style={{ padding: '0.4rem', borderRadius: '6px', background: 'var(--accent-purple-subtle)', color: 'var(--accent-purple)' }}>
            <ArrowLeftRight size={16} />
          </div>
        </div>
        <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          {loading ? '...' : (stats?.total_transactions?.toLocaleString() ?? '—')}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          <span className="mono" style={{ color: 'var(--accent-purple)' }}>[:SENT]</span> payment relationships
        </div>
      </div>

      {/* Detection Runs */}
      <div className="rt-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            Detection Runs
          </span>
          <div style={{ padding: '0.4rem', borderRadius: '6px', background: 'rgba(148, 163, 184, 0.12)', color: '#94a3b8' }}>
            <FileSearch size={16} />
          </div>
        </div>
        <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          {runCount}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {latestRun ? `${latestRun.pattern.replace('_', '-')} · ${latestRun.summary.status}` : 'No detector has run yet'}
        </div>
      </div>

      {/* Suspicious Candidates */}
      <div className="rt-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            Suspicious Candidates
          </span>
          <div style={{ padding: '0.4rem', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.12)', color: 'var(--accent-amber)' }}>
            <ShieldAlert size={16} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: '0.2rem' }}>
          <span className="rt-badge badge-warning" style={{ fontSize: '0.85rem', padding: '0.25rem 0.6rem' }}>
            {latestRun?.summary.status === 'completed' ? latestRun.summary.suspicious : 'Not evaluated'}
          </span>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {latestRun?.summary.status === 'completed'
            ? `${latestRun.summary.hits} candidates in the last ${latestRun.pattern.replace('_', '-')} run`
            : latestRun?.summary.status === 'failed' ? 'Last run failed; retry from a detector card' : 'Run a detector to see actual results'}
        </div>
      </div>

      {/* Case review queue is not implemented yet */}
      <div className="rt-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>Cases needing review</span>
          <div style={{ padding: '0.4rem', borderRadius: '6px', background: 'rgba(148, 163, 184, 0.12)', color: '#94a3b8' }}><FileSearch size={16} /></div>
        </div>
        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: '0.2rem' }}>Not available</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Case building and scoring are not connected yet</div>
      </div>
    </div>
  );
};

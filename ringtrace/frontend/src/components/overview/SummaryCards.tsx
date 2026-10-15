import React from 'react';
import { Users, ArrowLeftRight, FileSearch, ShieldAlert } from 'lucide-react';
import type { SystemStats } from '../../types';

interface SummaryCardsProps {
  stats: SystemStats | null;
  loading: boolean;
}

export const SummaryCards: React.FC<SummaryCardsProps> = ({ stats, loading }) => {
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

      {/* Active Investigations */}
      <div className="rt-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            Active Investigations
          </span>
          <div style={{ padding: '0.4rem', borderRadius: '6px', background: 'rgba(148, 163, 184, 0.12)', color: '#94a3b8' }}>
            <FileSearch size={16} />
          </div>
        </div>
        <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          {loading ? '...' : (stats?.active_investigations ?? 0)}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {stats?.investigation_status || 'Investigation engine idle'}
        </div>
      </div>

      {/* Suspicious Patterns */}
      <div className="rt-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            Suspicious Patterns
          </span>
          <div style={{ padding: '0.4rem', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.12)', color: 'var(--accent-amber)' }}>
            <ShieldAlert size={16} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: '0.2rem' }}>
          <span className="rt-badge badge-warning" style={{ fontSize: '0.85rem', padding: '0.25rem 0.6rem' }}>
            {loading ? '...' : (stats?.suspicious_patterns_detected || 'Not yet analyzed')}
          </span>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {stats?.detection_engine_status || 'Detectors not yet executed'}
        </div>
      </div>
    </div>
  );
};

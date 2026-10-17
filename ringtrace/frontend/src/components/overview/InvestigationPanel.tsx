import React from 'react';
import { FileSearch, Clock, ShieldAlert } from 'lucide-react';

interface InvestigationPanelProps {
  onLaunchInvestigation?: () => void;
}

export const InvestigationPanel: React.FC<InvestigationPanelProps> = ({ onLaunchInvestigation }) => {
  return (
    <div className="rt-card" style={{ width: '360px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
        <div style={{ padding: '0.35rem', borderRadius: '6px', background: 'rgba(148, 163, 184, 0.12)', color: '#94a3b8' }}>
          <FileSearch size={16} />
        </div>
        <div>
          <h3 style={{ fontSize: '0.95rem' }}>Active Investigations</h3>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
            Financial crime case management
          </div>
        </div>
      </div>

      {/* Honest Empty State */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1.5rem',
        textAlign: 'center',
        backgroundColor: 'rgba(0,0,0,0.15)',
        borderRadius: '6px',
        border: '1px dashed var(--border-subtle)',
        gap: '0.75rem'
      }}>
        <div style={{
          width: '42px',
          height: '42px',
          borderRadius: '50%',
          backgroundColor: 'rgba(255,255,255,0.03)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)'
        }}>
          <Clock size={20} />
        </div>
        <div>
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
            Autonomous Agent Cockpit
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: '0.75rem' }}>
            Investigate seeded cases (CASE_0001, CASE_0002) with the 8-tool graph engine and live SSE streams.
          </div>
          {onLaunchInvestigation && (
            <button
              onClick={onLaunchInvestigation}
              className="rt-button rt-button-primary rt-button-sm"
              style={{ width: '100%' }}
            >
              Open Investigation Cockpit →
            </button>
          )}
        </div>

        <div style={{ width: '100%', marginTop: '0.75rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem', textAlign: 'left' }}>
            Target Detection Typologies:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            {['cycle', 'fan_in', 'fan_out', 'relay_chain', 'scatter_gather', 'gather_scatter'].map((p) => (
              <span key={p} className="rt-badge badge-personal" style={{ fontSize: '0.675rem' }}>
                <ShieldAlert size={10} />
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

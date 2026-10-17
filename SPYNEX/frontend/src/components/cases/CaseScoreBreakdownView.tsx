import React from 'react';
import type { CaseScoreBreakdown } from '../../types';

interface CaseScoreBreakdownViewProps {
  score: number;
  severity: string;
  breakdown: CaseScoreBreakdown | null | undefined;
}

const COMPONENTS = [
  { key: 'severity', label: 'Pattern Severity', max: 35, color: '#38A189', desc: 'Base severity from highest-risk pattern' },
  { key: 'amount', label: 'Amount Volume', max: 20, color: '#0284C7', desc: 'Logarithmic scaling of total routed INR' },
  { key: 'velocity', label: 'Velocity & Speed', max: 15, color: '#F59E0B', desc: 'Burst duration and pass-through speed' },
  { key: 'account_count', label: 'Account Footprint', max: 10, color: '#8B5CF6', desc: 'Complexity and ring participation' },
  { key: 'corroboration', label: 'Pattern Corroboration', max: 20, color: '#EC4899', desc: 'Multi-pattern overlap & hub signals' },
] as const;

export const CaseScoreBreakdownView: React.FC<CaseScoreBreakdownViewProps> = ({
  score,
  severity,
  breakdown,
}) => {
  const getSeverityBadgeClass = (sev: string) => {
    switch (sev.toLowerCase()) {
      case 'high':
        return 'rt-badge-rose';
      case 'medium':
        return 'rt-badge-amber';
      default:
        return 'rt-badge-gray';
    }
  };

  return (
    <div className="rt-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.25rem' }}>
      {/* Score Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Triage Priority Score
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.65rem', marginTop: '0.2rem' }}>
            <span style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {score}
            </span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>/ 100</span>
            <span className={`rt-badge ${getSeverityBadgeClass(severity)}`} style={{ fontSize: '0.725rem', textTransform: 'uppercase' }}>
              {severity} Priority
            </span>
          </div>
        </div>

        {breakdown?.origin_context_adjustment ? (
          <div
            style={{
              padding: '0.4rem 0.65rem',
              borderRadius: '6px',
              backgroundColor: 'var(--brand-mint-subtle)',
              border: '1px solid rgba(56, 161, 137, 0.3)',
              fontSize: '0.7rem',
              color: 'var(--brand-forest)',
              maxWidth: '220px',
            }}
          >
            <strong>Origin Adjustment:</strong> {breakdown.origin_context_adjustment} pts discount applied (merchant/payroll origin).
          </div>
        ) : null}
      </div>

      {/* 5-Component Progress Bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {COMPONENTS.map((comp) => {
          const val = breakdown ? (breakdown[comp.key as keyof CaseScoreBreakdown] as number) || 0 : 0;
          const pct = Math.min(100, Math.round((val / comp.max) * 100));

          return (
            <div key={comp.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{comp.label}</span>
                <span className="mono" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                  {val} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/ {comp.max}</span>
                </span>
              </div>
              <div
                style={{
                  height: '6px',
                  backgroundColor: 'var(--surface-muted)',
                  borderRadius: '3px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${pct}%`,
                    backgroundColor: comp.color,
                    borderRadius: '3px',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
              <div style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>{comp.desc}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

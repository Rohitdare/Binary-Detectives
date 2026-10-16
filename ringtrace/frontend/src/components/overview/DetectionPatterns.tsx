import React from 'react';
import { ArrowRight, CircleDashed, GitBranch, Network, Play } from 'lucide-react';
import type { DetectorPattern, DetectorRunSummary } from '../../types';

interface DetectionPatternsProps {
  runs: Partial<Record<DetectorPattern, DetectorRunSummary>>;
  onRun: (pattern: DetectorPattern) => void;
}

const DETECTORS: Array<{
  id: DetectorPattern;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: 'cycle', title: 'Cycle', description: 'Money moves through a chain of accounts and returns to where it started.', icon: CircleDashed },
  { id: 'fan_in', title: 'Fan-in', description: 'Many senders transfer money to one account in a short time window.', icon: GitBranch },
  { id: 'fan_out', title: 'Fan-out', description: 'One account sends money to many recipients in a short time window.', icon: Network },
];

export const DetectionPatterns: React.FC<DetectionPatternsProps> = ({ runs, onRun }) => (
  <section aria-labelledby="detection-patterns-title" style={{ marginBottom: '1.5rem' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem', gap: '1rem' }}>
      <div>
        <h2 id="detection-patterns-title" style={{ fontSize: '1rem', margin: 0 }}>Available detection patterns</h2>
        <p className="text-secondary" style={{ fontSize: '0.78rem', margin: '0.25rem 0 0' }}>Only connected detectors are listed. A pattern match is a lead for review, not proof of crime.</p>
      </div>
      <span className="rt-badge rt-badge-cyan">3 ready</span>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.85rem' }}>
      {DETECTORS.map((detector) => {
        const run = runs[detector.id];
        const Icon = detector.icon;
        const status = run?.status ?? 'ready';
        const label = status === 'completed'
          ? `${run?.hits ?? 0} candidates · ${run?.suspicious ?? 0} need review`
          : status === 'failed' ? 'Last run failed' : status === 'running' ? 'Detection is running' : 'Not run yet';
        return (
          <article key={detector.id} className="rt-card" style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.55rem' }}>
              <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center' }}>
                <Icon size={17} className="text-accent-cyan" />
                <h3 style={{ fontSize: '0.9rem', margin: 0 }}>{detector.title}</h3>
              </div>
              <span className={`rt-badge ${status === 'failed' ? 'rt-badge-rose' : status === 'running' ? 'rt-badge-gray' : 'rt-badge-emerald'}`} style={{ fontSize: '0.65rem' }}>
                {status === 'ready' ? 'Ready' : status[0].toUpperCase() + status.slice(1)}
              </span>
            </div>
            <p className="text-secondary" style={{ minHeight: '2.4rem', fontSize: '0.76rem', lineHeight: 1.45, margin: '0 0 0.65rem' }}>{detector.description}</p>
            <div aria-live="polite" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>{label}</div>
            <button className="rt-button rt-button-primary" onClick={() => onRun(detector.id)} disabled={status === 'running'} style={{ width: '100%' }}>
              {status === 'running' ? <ArrowRight size={14} className="spin" /> : <Play size={13} />}
              <span>{status === 'running' ? 'Running…' : 'Run detector'}</span>
            </button>
          </article>
        );
      })}
    </div>
  </section>
);

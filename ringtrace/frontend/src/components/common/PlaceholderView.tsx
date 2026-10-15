import React from 'react';
import { Compass, FileSearch, Network, Layers, Settings, ArrowLeft } from 'lucide-react';
import type { PageTab } from '../../types';

interface PlaceholderViewProps {
  tab: PageTab;
  onBackToOverview: () => void;
}

const TAB_META: Record<PageTab, { title: string; subtitle: string; icon: React.ComponentType<{ size?: number }>; status: string; description: string }> = {
  overview: {
    title: 'Overview',
    subtitle: 'System Dashboard',
    icon: Compass,
    status: 'Active',
    description: 'Active dashboard.',
  },
  explorer: {
    title: 'Transaction Explorer',
    subtitle: 'Account Neighborhood Tracing',
    icon: Compass,
    status: 'Active',
    description: 'Active explorer.',
  },
  investigations: {
    title: 'Investigations & Cases',
    subtitle: 'Autonomous Financial Crime Investigation Workflow',
    icon: FileSearch,
    status: 'Planned for Phase 2',
    description: 'Autonomous casebook management and investigation agent. This module will ingest detected suspicious clusters, query FalkorDB shortest paths and time-ordered traces, and compile explainable SAR (Suspicious Activity Report) summaries.',
  },
  patterns: {
    title: 'Detection Patterns Engine',
    subtitle: 'Graph Algorithmic Typology Detectors',
    icon: Network,
    status: 'Planned for Phase 2',
    description: 'Centralized Cypher detection queries targeting the 8 planted money laundering typologies: time-respecting cycles, fan-in structuring under ₹50k, fan-out dispersal, relay chains with hop decay, scatter-gather, and dense clusters.',
  },
  evidence: {
    title: 'Evidence & Findings',
    subtitle: 'Ground-Truth Verification & Audit Trail',
    icon: Layers,
    status: 'Planned for Phase 2',
    description: 'Separated evaluator interface to benchmark detector Precision, Recall, and F1 against the isolated FalkorDB labels graph without leaking ground truth to operational detectors.',
  },
  settings: {
    title: 'System Settings',
    subtitle: 'Environment & FalkorDB Connection Configuration',
    icon: Settings,
    status: 'Planned for Phase 3',
    description: 'FalkorDB host, port, graph selector (txn vs test_txn), simulator seed management, and streaming replay worker frequency controls.',
  },
};

export const PlaceholderView: React.FC<PlaceholderViewProps> = ({ tab, onBackToOverview }) => {
  const meta = TAB_META[tab] || TAB_META.settings;
  const Icon = meta.icon;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingTop: '1.5rem' }}>
      <button onClick={onBackToOverview} className="rt-button" style={{ alignSelf: 'flex-start' }}>
        <ArrowLeft size={14} />
        <span>Back to Overview</span>
      </button>

      <div className="rt-card" style={{ padding: '2.5rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
        <div style={{
          width: '56px',
          height: '56px',
          borderRadius: '12px',
          backgroundColor: 'rgba(56, 189, 248, 0.1)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent-cyan)'
        }}>
          <Icon size={28} />
        </div>

        <div>
          <span className="rt-badge badge-warning" style={{ marginBottom: '0.75rem' }}>
            {meta.status}
          </span>
          <h2 style={{ fontSize: '1.4rem', color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
            {meta.title}
          </h2>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {meta.subtitle}
          </div>
        </div>

        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', maxWidth: '580px', lineHeight: 1.6 }}>
          {meta.description}
        </p>

        <div style={{
          marginTop: '1rem',
          padding: '1rem 1.25rem',
          backgroundColor: 'var(--bg-base)',
          borderRadius: '6px',
          border: '1px solid var(--border-subtle)',
          fontSize: '0.775rem',
          color: 'var(--text-muted)',
          maxWidth: '520px',
          textAlign: 'left',
          lineHeight: 1.5
        }}>
          <strong>Design Note:</strong> RingTrace adheres strictly to honesty in software engineering. Rather than fabricating mock detections, this tab will be powered by real graph algorithms and LLM reasoning in the subsequent milestones.
        </div>
      </div>
    </div>
  );
};

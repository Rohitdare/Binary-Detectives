import React from 'react';
import { Compass, FileSearch, Network, Layers, Settings, ArrowLeft, Shield, CheckCircle, Database } from 'lucide-react';
import type { PageTab } from '../../types';

interface PlaceholderViewProps {
  tab: PageTab;
  onBackToOverview: () => void;
}

const TAB_META: Record<PageTab, { title: string; subtitle: string; icon: React.ComponentType<{ size?: number }>; status: string; description: string; points: string[] }> = {
  overview: {
    title: 'Overview',
    subtitle: 'System Dashboard',
    icon: Compass,
    status: 'Active',
    description: 'Real-time financial intelligence overview.',
    points: ['FalkorDB txn graph stats', 'Topology sampling', 'Recent ledger audit']
  },
  explorer: {
    title: 'Transaction Explorer',
    subtitle: 'Account Neighborhood Tracing',
    icon: Compass,
    status: 'Active',
    description: 'Forensic account neighborhood and concentric transaction graph tracing.',
    points: ['1-hop directed subgraph', 'Inflow & outflow ledgers', 'Community cluster indexing']
  },
  investigations: {
    title: 'Investigations & Cases',
    subtitle: 'Autonomous Financial Crime Investigation Workflow',
    icon: FileSearch,
    status: 'Phase 2 Architecture',
    description: 'Autonomous casebook management and multi-turn reasoning agent. Ingests detected suspicious clusters, executes shortest-path Cypher traversals in FalkorDB, and compiles regulatory SAR (Suspicious Activity Report) summaries with evidence provenance.',
    points: [
      'Multi-hop path exploration with openCypher',
      'Traceable evidence graphs with zero ground-truth leakage',
      'Human-in-the-loop decision triage: Escalate, Monitor, or Dismiss',
      'Automated SAR filing narrative generation'
    ]
  },
  patterns: {
    title: 'Detection Patterns Engine',
    subtitle: 'Graph Algorithmic Typology Detectors',
    icon: Network,
    status: 'Active · 3 Planted Typologies',
    description: 'Centralized Cypher detection queries targeting money laundering typologies: time-respecting cycles, fan-in structuring under reporting limits, and fan-out rapid dispersal.',
    points: ['Cycle detection (3-5 hops)', 'Fan-in structuring (<₹50k batching)', 'Fan-out rapid dispersal']
  },
  evidence: {
    title: 'Evidence & Audit Benchmark',
    subtitle: 'Ground-Truth Verification & Evaluation Sandbox',
    icon: Layers,
    status: 'Phase 2 Benchmark Sandbox',
    description: 'Separated evaluator interface to benchmark detector Precision, Recall, and F1 against the isolated FalkorDB labels graph without leaking ground truth to operational production detectors.',
    points: [
      'Isolated FalkorDB labels graph comparison',
      'Planted fraud alerts vs benign look-alikes',
      'Exact recall, total recall, and precision scoring',
      'Zero ground-truth leakage enforcement (AGENTS_MEMBER_A.md)'
    ]
  },
  settings: {
    title: 'System Settings',
    subtitle: 'Environment & FalkorDB Connection Configuration',
    icon: Settings,
    status: 'Environment Controls',
    description: 'FalkorDB host, port, graph selector (txn vs test_txn), simulator seed management, and streaming replay worker frequency controls.',
    points: [
      'FalkorDB connection: localhost:6379',
      'Active graph: txn (40,661 edges, 3,000 accounts)',
      'FastAPI backend: http://localhost:8000',
      'Strict parameterization & openCypher <> compliance'
    ]
  },
};

export const PlaceholderView: React.FC<PlaceholderViewProps> = ({ tab, onBackToOverview }) => {
  const meta = TAB_META[tab] || TAB_META.settings;
  const Icon = meta.icon;

  return (
    <div style={{ maxWidth: '840px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingTop: '1rem' }}>
      <button onClick={onBackToOverview} className="rt-button" style={{ alignSelf: 'flex-start' }}>
        <ArrowLeft size={14} />
        <span>Return to Overview</span>
      </button>

      <div className="rt-card" style={{ padding: '2.5rem 2.25rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '1.25rem' }}>
        <div style={{
          width: '60px',
          height: '60px',
          borderRadius: '14px',
          backgroundColor: 'var(--brand-mint-subtle)',
          border: '1px solid rgba(56, 161, 137, 0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--brand-forest)',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <Icon size={28} />
        </div>

        <div>
          <span className="rt-badge rt-badge-emerald" style={{ marginBottom: '0.65rem' }}>
            {meta.status}
          </span>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 0.35rem 0' }}>
            {meta.title}
          </h2>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {meta.subtitle}
          </div>
        </div>

        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', maxWidth: '640px', lineHeight: 1.6, margin: 0 }}>
          {meta.description}
        </p>

        {/* Structured Spec Points */}
        <div style={{
          width: '100%',
          marginTop: '0.5rem',
          padding: '1.25rem 1.5rem',
          backgroundColor: 'var(--surface-secondary)',
          borderRadius: '8px',
          border: '1px solid var(--border-subtle)',
          textAlign: 'left'
        }}>
          <div style={{
            fontSize: '0.725rem',
            fontWeight: 700,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            marginBottom: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem'
          }}>
            <Shield size={13} color="var(--brand-teal)" />
            <span>Architecture & Regulatory Constraints</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.65rem' }}>
            {meta.points.map((pt, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.775rem', color: 'var(--text-primary)' }}>
                <CheckCircle size={14} color="var(--brand-teal)" style={{ flexShrink: 0 }} />
                <span>{pt}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Database Integrity Notice */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.75rem',
          color: 'var(--text-muted)'
        }}>
          <Database size={13} />
          <span>FalkorDB singleton client active · All production state preserved</span>
        </div>
      </div>
    </div>
  );
};

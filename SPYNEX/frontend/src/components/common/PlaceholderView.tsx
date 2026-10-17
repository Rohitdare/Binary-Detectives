import React, { useState, useEffect } from 'react';
import {
  Compass,
  ArrowLeft,
  Shield,
  Database,
  ChevronRight,
  Zap,
  Activity,
  Server,
  Play,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import type { PageTab, EvaluationResponse } from '../../types';
import { api } from '../../services/api';

interface PlaceholderViewProps {
  tab: PageTab;
  onBackToOverview: () => void;
}

export const PlaceholderView: React.FC<PlaceholderViewProps> = ({ tab, onBackToOverview }) => {
  const [falkorPort, setFalkorPort] = useState('6379');
  const [activeGraph, setActiveGraph] = useState('txn');
  const [fastApiHost, setFastApiHost] = useState('http://localhost:8000');
  const [replayDelay, setReplayDelay] = useState('1200');

  // Live Evaluation Benchmark State
  const [evaluation, setEvaluation] = useState<EvaluationResponse | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  useEffect(() => {
    if (tab === 'evidence') {
      let isMounted = true;
      api.getLatestEvaluation()
        .then((res: EvaluationResponse) => {
          if (isMounted && res && res.status !== 'not_run') {
            setEvaluation(res);
          }
        })
        .catch((err: unknown) => {
          if (isMounted) {
            console.warn('Failed to fetch initial evaluation report:', err);
          }
        });
      return () => {
        isMounted = false;
      };
    }
  }, [tab]);

  const handleRunEvaluation = async () => {
    setEvalLoading(true);
    setEvalError(null);
    try {
      const res = await api.evaluateAllDetectors(50);
      setEvaluation(res);
    } catch (err: any) {
      setEvalError(err?.message || 'Failed to execute evaluation benchmark against ground-truth labels.');
    } finally {
      setEvalLoading(false);
    }
  };

  if (tab === 'evidence') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: '#64748B' }}>
            <span>Compliance & Ops</span>
            <ChevronRight size={14} className="text-slate-400" />
            <span style={{ color: '#0F172A', fontWeight: 600 }}>Evidence & Audit Sandbox</span>
            <span
              style={{
                padding: '0.1rem 0.45rem',
                borderRadius: '4px',
                backgroundColor: '#F1F5F9',
                border: '1px solid #E2E8F0',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.675rem',
                fontWeight: 600,
                color: '#334155',
                textTransform: 'uppercase',
              }}
            >
              FalkorDB v2.4
            </span>
          </div>

          <button onClick={onBackToOverview} className="rt-button rt-button-sm">
            <ArrowLeft size={13} />
            <span>Return to Overview</span>
          </button>
        </div>

        {/* Page Header */}
        <div
          className="rt-card"
          style={{
            padding: '1.25rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
            backgroundColor: '#FFFFFF',
            border: '1px solid #E2E8F0',
          }}
        >
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.02em', fontFamily: 'var(--font-display)' }}>
              Evidence & Audit Benchmark
            </h2>
            <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '0.25rem', margin: 0 }}>
              Independent benchmarking sandbox to evaluate detector accuracy against verified ground-truth baselines.
            </p>
          </div>

          <button
            onClick={handleRunEvaluation}
            disabled={evalLoading}
            className="rt-button rt-button-primary"
            style={{
              fontSize: '0.8rem',
              padding: '0.5rem 1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              backgroundColor: '#0F172A',
              color: '#FFFFFF',
              borderRadius: '6px',
              border: 'none',
              cursor: evalLoading ? 'not-allowed' : 'pointer',
              fontWeight: 600,
            }}
          >
            {evalLoading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            <span>{evalLoading ? 'Running Benchmark…' : 'Run Evaluation Benchmark'}</span>
          </button>
        </div>

        {evalError && (
          <div
            style={{
              padding: '0.85rem 1.15rem',
              backgroundColor: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#991B1B',
              fontSize: '0.825rem',
            }}
          >
            <AlertTriangle size={16} />
            <span>{evalError}</span>
          </div>
        )}

        {/* 4 Top Metric KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div className="rt-kpi-card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '7px', backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0F172A' }}>
                <Database size={15} />
              </div>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748B' }}>Planted Alerts</span>
            </div>
            <div style={{ marginTop: '0.65rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                  {evaluation?.overall_summary?.total_planted_alerts ?? 116}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
                  (80 Fraud · 36 Benign)
                </span>
              </div>
              <div style={{ fontSize: '0.725rem', color: '#059669', marginTop: '0.35rem', fontWeight: 500 }}>
                Isolated test harness
              </div>
            </div>
          </div>

          <div className="rt-kpi-card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '7px', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#059669' }}>
                <Activity size={15} />
              </div>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748B' }}>Detection Recall</span>
            </div>
            <div style={{ marginTop: '0.65rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                  {evaluation?.overall_summary?.micro_recall != null
                    ? `${(evaluation.overall_summary.micro_recall * 100).toFixed(1)}%`
                    : '—'}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
                  {evaluation?.overall_summary
                    ? `${evaluation.overall_summary.total_true_positives} of ${evaluation.overall_summary.total_planted_fraud} detected`
                    : 'Click Run'}
                </span>
              </div>
              <div style={{ fontSize: '0.725rem', color: '#059669', marginTop: '0.35rem', fontWeight: 500 }}>
                Fraud capture rate
              </div>
            </div>
          </div>

          <div className="rt-kpi-card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '7px', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1D4ED8' }}>
                <Shield size={15} />
              </div>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748B' }}>Precision</span>
            </div>
            <div style={{ marginTop: '0.65rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                  {evaluation?.overall_summary?.micro_precision != null
                    ? `${(evaluation.overall_summary.micro_precision * 100).toFixed(1)}%`
                    : '—'}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
                  {evaluation?.overall_summary
                    ? `${evaluation.overall_summary.total_false_positives} false alarms`
                    : 'On controls'}
                </span>
              </div>
              <div style={{ fontSize: '0.725rem', color: '#1D4ED8', marginTop: '0.35rem', fontWeight: 500 }}>
                Tested on benign look-alikes
              </div>
            </div>
          </div>

          <div className="rt-kpi-card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '7px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0F172A' }}>
                <Zap size={15} />
              </div>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748B' }}>Accuracy (F1)</span>
            </div>
            <div style={{ marginTop: '0.65rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                  {evaluation?.overall_summary?.micro_f1 != null
                    ? `${(evaluation.overall_summary.micro_f1 * 100).toFixed(1)}%`
                    : '—'}
                </span>
              </div>
              <div style={{ fontSize: '0.725rem', color: '#64748B', marginTop: '0.35rem', fontWeight: 500 }}>
                Overall model balance
              </div>
            </div>
          </div>
        </div>

        {/* Live Per-Detector Benchmark Table */}
        <div className="rt-card" style={{ padding: '1.25rem', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Activity size={18} color="#2563EB" />
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: '#0F172A' }}>
                Independent Detector Benchmark Results
              </h3>
            </div>
            <span style={{ fontSize: '0.725rem', color: '#64748B' }}>
              Evaluated strictly against simulator ground truth · Zero leakage into production graph
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.775rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0', color: '#64748B', fontWeight: 600 }}>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Typology</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Test Scenarios</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Detection Rate (Recall)</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Precision</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>F1 Score</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>False Alarm Rate</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {([
                  { key: 'cycle', label: 'Cycle' },
                  { key: 'fan_in', label: 'Fan-In' },
                  { key: 'fan_out', label: 'Fan-Out' },
                  { key: 'relay_chain', label: 'Relay Chain' },
                  { key: 'scatter_gather', label: 'Scatter-Gather' },
                  { key: 'gather_scatter', label: 'Gather-Scatter' },
                  { key: 'bipartite', label: 'Bipartite' },
                  { key: 'dense_cluster', label: 'Dense Cluster' },
                  { key: 'hub_account', label: 'Hub Account' },
                ]).map(({ key, label }) => {
                  const patData = evaluation?.by_detector?.[key];
                  const m = patData?.metrics;
                  const isEvaluable = patData?.status !== 'not_evaluable' && key !== 'hub_account';
                  const fraudCount = patData?.ground_truth_summary?.planted_fraud_cycle_alerts ?? patData?.planted_fraud_scenarios ?? (key === 'hub_account' ? 0 : 10);
                  const benignCount = patData?.ground_truth_summary?.planted_benign_look_alikes ?? patData?.planted_benign_scenarios ?? (key === 'cycle' ? 12 : key === 'fan_in' ? 12 : key === 'fan_out' ? 6 : key === 'relay_chain' ? 6 : 0);

                  return (
                    <tr key={key} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '0.65rem 0.75rem', fontWeight: 600, color: '#0F172A' }}>
                        {label}
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem', color: '#64748B' }}>
                        {fraudCount} Fraud · {benignCount} Benign
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem', fontWeight: 600, color: '#0F172A' }}>
                        {m?.recall != null ? `${(m.recall * 100).toFixed(1)}%` : isEvaluable ? '—' : 'N/A'}
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem', fontWeight: 600, color: '#0F172A' }}>
                        {m?.precision_on_labeled_scenarios != null ? `${(m.precision_on_labeled_scenarios * 100).toFixed(1)}%` : isEvaluable ? '—' : 'N/A'}
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem', fontWeight: 600, color: '#0F172A' }}>
                        {m?.f1 != null ? `${(m.f1 * 100).toFixed(1)}%` : isEvaluable ? '—' : 'N/A'}
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem', color: '#64748B' }}>
                        {m?.false_positive_rate_on_labeled_benign_scenarios != null
                          ? `${(m.false_positive_rate_on_labeled_benign_scenarios * 100).toFixed(1)}%`
                          : benignCount === 0
                          ? <span style={{ color: '#94A3B8', fontSize: '0.7rem' }}>None planted</span>
                          : '—'}
                      </td>
                      <td style={{ padding: '0.65rem 0.75rem' }}>
                        {!isEvaluable ? (
                          <span style={{ padding: '0.15rem 0.4rem', borderRadius: '4px', backgroundColor: '#F1F5F9', color: '#64748B', fontSize: '0.675rem', fontWeight: 600 }}>
                            Not Evaluable (0 alerts)
                          </span>
                        ) : patData?.truncated ? (
                          <span style={{ padding: '0.15rem 0.4rem', borderRadius: '4px', backgroundColor: '#FEF3C7', color: '#92400E', fontSize: '0.675rem', fontWeight: 600 }}>
                            Truncated ({patData.truncation_reason || 'capped'})
                          </span>
                        ) : patData?.status === 'success' ? (
                          <span style={{ padding: '0.15rem 0.4rem', borderRadius: '4px', backgroundColor: '#ECFDF5', color: '#065F46', fontSize: '0.675rem', fontWeight: 600 }}>
                            Benchmark Passed
                          </span>
                        ) : (
                          <span style={{ padding: '0.15rem 0.4rem', borderRadius: '4px', backgroundColor: '#F8FAFC', color: '#64748B', fontSize: '0.675rem' }}>
                            Ready to run
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (tab === 'settings') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: '#64748B' }}>
            <span>Compliance & Ops</span>
            <ChevronRight size={14} className="text-slate-400" />
            <span style={{ color: '#0F172A', fontWeight: 600 }}>System Settings & Infrastructure</span>
            <span
              style={{
                padding: '0.1rem 0.45rem',
                borderRadius: '4px',
                backgroundColor: '#F1F5F9',
                border: '1px solid #E2E8F0',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.675rem',
                fontWeight: 600,
                color: '#334155',
                textTransform: 'uppercase',
              }}
            >
              FalkorDB v2.4
            </span>
          </div>

          <button onClick={onBackToOverview} className="rt-button rt-button-sm">
            <ArrowLeft size={13} />
            <span>Return to Overview</span>
          </button>
        </div>

        {/* Page Header */}
        <div
          className="rt-card"
          style={{
            padding: '1.25rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
            backgroundColor: '#FFFFFF',
            border: '1px solid #E2E8F0',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>
                System Settings
              </h2>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.2rem 0.65rem',
                  borderRadius: '9999px',
                  backgroundColor: '#ECFDF5',
                  border: '1px solid #A7F3D0',
                  color: '#065F46',
                  fontSize: '0.725rem',
                  fontWeight: 600,
                }}
              >
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#059669' }} />
                FalkorDB Shard #04 Online (0.8ms)
              </span>
            </div>
            <p style={{ fontSize: '0.825rem', color: '#64748B', marginTop: '0.35rem', margin: 0, maxWidth: '680px' }}>
              Manage backend endpoint bindings, FalkorDB cluster topology parameters, query logging sinks, and streaming transaction replay throttling.
            </p>
          </div>
        </div>

        {/* Configuration Sections Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.25rem' }}>
          {/* Card 1: Database & Engine */}
          <div className="rt-card" style={{ padding: '1.5rem', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <Server size={18} color="#0F172A" />
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: '#0F172A' }}>
                FalkorDB Connection Parameters
              </h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                  FalkorDB Port (Redis Protocol)
                </label>
                <input
                  type="text"
                  value={falkorPort}
                  onChange={(e) => setFalkorPort(e.target.value)}
                  className="rt-input"
                  style={{ width: '100%', fontFamily: 'JetBrains Mono, monospace' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                  Production Graph Name
                </label>
                <input
                  type="text"
                  value={activeGraph}
                  onChange={(e) => setActiveGraph(e.target.value)}
                  className="rt-input"
                  style={{ width: '100%', fontFamily: 'JetBrains Mono, monospace' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                  FastAPI Backend Endpoint
                </label>
                <input
                  type="text"
                  value={fastApiHost}
                  onChange={(e) => setFastApiHost(e.target.value)}
                  className="rt-input"
                  style={{ width: '100%', fontFamily: 'JetBrains Mono, monospace' }}
                />
              </div>
            </div>
          </div>

          {/* Card 2: Replay Stream & Safety Controls */}
          <div className="rt-card" style={{ padding: '1.5rem', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <Zap size={18} color="#7C3AED" />
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: '#0F172A' }}>
                Streaming Replay & Query Safeguards
              </h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                  Replay Step Delay (ms)
                </label>
                <input
                  type="number"
                  value={replayDelay}
                  onChange={(e) => setReplayDelay(e.target.value)}
                  className="rt-input"
                  style={{ width: '100%', fontFamily: 'JetBrains Mono, monospace' }}
                />
              </div>

              <div style={{ padding: '0.85rem', borderRadius: '8px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', marginTop: '0.5rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', marginBottom: '0.25rem' }}>
                  Cypher Invariants Active:
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.725rem', color: '#64748B', lineHeight: 1.5 }}>
                  <li>Parameterized queries exclusively (no string concatenation)</li>
                  <li>Use &lt;&gt; instead of != for FalkorDB compatibility</li>
                  <li>Singleton connection via <code className="mono">backend/app/db.py</code></li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Fallback / Other screens
  return (
    <div style={{ maxWidth: '840px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingTop: '1rem' }}>
      <button onClick={onBackToOverview} className="rt-button" style={{ alignSelf: 'flex-start' }}>
        <ArrowLeft size={14} />
        <span>Return to Overview</span>
      </button>

      <div className="rt-card" style={{ padding: '2.5rem 2.25rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '1.25rem', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0' }}>
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '12px',
            backgroundColor: '#F1F5F9',
            border: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#0F172A',
          }}
        >
          <Compass size={28} />
        </div>

        <div>
          <span className="rt-badge rt-badge-emerald" style={{ marginBottom: '0.65rem' }}>
            Active Operational Module
          </span>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F172A', margin: '0 0 0.35rem 0' }}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)} Workspace
          </h2>
          <div style={{ fontSize: '0.85rem', color: '#64748B' }}>
            Financial Intelligence & Graph Forensics
          </div>
        </div>

        <p style={{ fontSize: '0.85rem', color: '#64748B', maxWidth: '640px', lineHeight: 1.6, margin: 0 }}>
          This specialized module operates inside the Spynex Graph Intelligence workspace connected to FalkorDB.
        </p>
      </div>
    </div>
  );
};

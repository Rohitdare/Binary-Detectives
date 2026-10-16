import React, { useState, useEffect, useRef } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import {
  RotateCcw,
  Play,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  ExternalLink,
  ShieldAlert,
  Sliders,
  Info,
  Layers,
  Award,
} from 'lucide-react';
import type { CycleCandidate, CycleDetectionResponse, CycleEvaluationReport } from '../../types';
import { ringtraceApi } from '../../services/api';

interface CycleDetectionViewProps {
  onInspectAccount: (accountId: string) => void;
}

export const CycleDetectionView: React.FC<CycleDetectionViewProps> = ({ onInspectAccount }) => {
  const [minLength, setMinLength] = useState<number>(3);
  const [maxLength, setMaxLength] = useState<number>(5);
  const [limit, setLimit] = useState<number>(50);

  const [loading, setLoading] = useState<boolean>(false);
  const [evaluating, setEvaluating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [detectionResponse, setDetectionResponse] = useState<CycleDetectionResponse | null>(null);
  const [candidates, setCandidates] = useState<CycleCandidate[]>([]);
  const [selectedCycle, setSelectedCycle] = useState<CycleCandidate | null>(null);
  const [hasRun, setHasRun] = useState<boolean>(false);

  const [evaluationReport, setEvaluationReport] = useState<CycleEvaluationReport | null>(null);

  const cyContainerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  const handleRunDetection = async () => {
    if (minLength > maxLength) {
      setError('Minimum length cannot be greater than maximum length.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await ringtraceApi.detectCycles(minLength, maxLength, limit);
      setDetectionResponse(resp);
      setCandidates(resp.cycles);
      setHasRun(true);
      if (resp.cycles.length > 0) {
        setSelectedCycle(resp.cycles[0]);
      } else {
        setSelectedCycle(null);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to execute cycle detection.');
      setCandidates([]);
      setSelectedCycle(null);
    } finally {
      setLoading(false);
    }
  };

  const handleRunEvaluation = async () => {
    setEvaluating(true);
    setError(null);
    try {
      const rep = await ringtraceApi.evaluateCycles(limit);
      setEvaluationReport(rep);
    } catch (err: any) {
      setError(err?.message || 'Failed to execute cycle benchmark evaluation.');
    } finally {
      setEvaluating(false);
    }
  };

  // Automatically render Cytoscape circle graph when selectedCycle changes
  useEffect(() => {
    if (!cyContainerRef.current || !selectedCycle) return;

    if (cyRef.current) {
      cyRef.current.destroy();
    }

    const nodes = selectedCycle.accounts.map((accId, idx) => ({
      data: {
        id: accId,
        label: accId,
        index: idx + 1,
        isStart: idx === 0,
      },
    }));

    const edges = selectedCycle.transactions.map((tx, idx) => ({
      data: {
        id: tx.tx_id,
        source: tx.src,
        target: tx.dst,
        label: `$${tx.amount.toLocaleString()}`,
        hop: idx + 1,
        txType: tx.tx_type,
      },
    }));

    const cy = cytoscape({
      container: cyContainerRef.current,
      elements: [...nodes, ...edges],
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'color': '#f1f5f9',
            'font-size': '11px',
            'font-family': 'ui-monospace, monospace',
            'font-weight': 600,
            'text-valign': 'bottom',
            'text-margin-y': 6,
            'background-color': '#1e293b',
            'border-width': 2,
            'border-color': '#0ea5e9',
            'width': 34,
            'height': 34,
          },
        },
        {
          selector: 'node[?isStart]',
          style: {
            'background-color': '#0284c7',
            'border-color': '#38bdf8',
            'border-width': 3,
            'width': 40,
            'height': 40,
          },
        },
        {
          selector: 'edge',
          style: {
            'label': 'data(label)',
            'color': '#94a3b8',
            'font-size': '10px',
            'font-family': 'ui-monospace, monospace',
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#0ea5e9',
            'line-color': '#0284c7',
            'width': 2.5,
            'arrow-scale': 1.2,
            'text-background-color': '#0f172a',
            'text-background-opacity': 0.85,
            'text-background-padding': '2px',
            'text-rotation': 'autorotate',
          },
        },
      ],
      layout: {
        name: 'circle',
        padding: 50,
        radius: 110,
        avoidOverlap: true,
      },
      userZoomingEnabled: true,
      userPanningEnabled: true,
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
    };
  }, [selectedCycle]);

  return (
    <div className="cycle-detection-view" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header & Controls Card */}
      <div className="rt-card" style={{ padding: '1.25rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
              <RotateCcw className="text-accent-cyan" size={20} />
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Directed Transaction Cycle Detector</h2>
              <span className="rt-badge rt-badge-cyan" style={{ fontSize: '0.7rem' }}>FalkorDB Cypher Engine</span>
            </div>
            <p className="text-secondary" style={{ fontSize: '0.85rem', margin: 0, maxWidth: '780px' }}>
              Identifies closed money loops (<code className="mono">A → B → C → ... → A</code>) with canonical edge rotation,
              strict inter-hop temporal ordering, bounded laundering retention, and transaction evidence.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button
              onClick={handleRunDetection}
              disabled={loading}
              className="rt-button rt-button-primary"
              style={{ minWidth: '170px' }}
            >
              <Play size={15} className={loading ? 'spin' : ''} />
              <span>{loading ? 'Analyzing Graph...' : 'Run Cycle Detection'}</span>
            </button>
            <button
              onClick={handleRunEvaluation}
              disabled={evaluating}
              className="rt-button"
              style={{
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                color: '#38bdf8',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
              title="Run independent evaluation against simulator ground-truth labels"
            >
              <Award size={15} className={evaluating ? 'spin' : ''} />
              <span>{evaluating ? 'Evaluating...' : 'Evaluate Benchmark'}</span>
            </button>
          </div>
        </div>

        {/* Configuration Parameters */}
        <div style={{
          marginTop: '1.25rem',
          paddingTop: '1rem',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '1.5rem',
          flexWrap: 'wrap'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
            <Sliders size={15} className="text-secondary" />
            <span style={{ fontWeight: 600 }}>Parameters:</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Min Length:</label>
            <select
              value={minLength}
              onChange={(e) => setMinLength(Number(e.target.value))}
              disabled={loading}
              className="rt-input"
              style={{ width: '70px', padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
            >
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Max Length:</label>
            <select
              value={maxLength}
              onChange={(e) => setMaxLength(Number(e.target.value))}
              disabled={loading}
              className="rt-input"
              style={{ width: '70px', padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
            >
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Limit:</label>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              disabled={loading}
              className="rt-input"
              style={{ width: '85px', padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
            <Info size={13} />
            <span>Canonical edge rotation by smallest <code className="mono">tx_id</code> preserves edge order and handles parallel links.</span>
          </div>
        </div>
      </div>

      {/* Operational & Evaluation Metrics Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        {/* Metric 1: Configured Limit */}
        <div className="rt-card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>CONFIGURED LIMIT</span>
            <Sliders size={15} className="text-secondary" />
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{limit}</div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Max candidates requested</span>
        </div>

        {/* Metric 2: Candidates Returned */}
        <div className="rt-card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>CANDIDATES RETURNED</span>
            <Layers size={15} className="text-accent-cyan" />
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: hasRun ? '#38bdf8' : 'inherit' }}>
            {hasRun ? candidates.length : '—'}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            {hasRun ? `Lengths ${minLength}–${maxLength} hops` : 'Ready to execute'}
          </span>
        </div>

        {/* Metric 3: Truncation Flag */}
        <div className="rt-card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>TRUNCATION STATUS</span>
            <Clock size={15} className="text-secondary" />
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.2rem' }}>
            {detectionResponse ? (
              detectionResponse.truncated ? (
                <span className="rt-badge rt-badge-rose" style={{ fontSize: '0.75rem' }}>
                  Truncated ({detectionResponse.truncation_reason || 'result_limit'})
                </span>
              ) : (
                <span className="rt-badge rt-badge-emerald" style={{ fontSize: '0.75rem' }}>
                  Full Results (Not Truncated)
                </span>
              )
            ) : (
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>—</span>
            )}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Search limit boundary</span>
        </div>

        {/* Metric 4: Evaluation Benchmark */}
        <div className="rt-card" style={{ padding: '1rem 1.25rem', backgroundColor: evaluationReport ? 'rgba(56, 189, 248, 0.05)' : 'var(--bg-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>GROUND-TRUTH BENCHMARK</span>
            <Award size={15} className={evaluationReport ? 'text-accent-cyan' : 'text-secondary'} />
          </div>
          {evaluationReport ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.3rem', fontWeight: 700, color: '#10b981' }}>
                  {(evaluationReport.metrics.exact_recall * 100).toFixed(0)}% Recall
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  ({evaluationReport.matching_results.exact_matches_count}/{evaluationReport.ground_truth_summary.planted_fraud_cycle_alerts} exact)
                </span>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                Precision: {(evaluationReport.metrics.precision * 100).toFixed(0)}% · Benign FP: {Object.values(evaluationReport.matching_results.benign_false_positives).reduce((a, b) => a + b, 0)}
              </span>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Not evaluated</div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Click "Evaluate Benchmark"</span>
            </div>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div style={{
          backgroundColor: 'rgba(244, 63, 94, 0.12)',
          border: '1px solid rgba(244, 63, 94, 0.3)',
          borderRadius: 'var(--radius-md)',
          padding: '0.85rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          color: 'var(--accent-rose)',
          fontSize: '0.875rem'
        }}>
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Main Analysis Results */}
      {!hasRun && !loading && (
        <div className="rt-card" style={{ padding: '3.5rem 2rem', textAlign: 'center' }}>
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            backgroundColor: 'rgba(14, 165, 233, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.25rem auto',
            color: 'var(--accent-cyan)'
          }}>
            <RotateCcw size={28} />
          </div>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '0.5rem' }}>Detector Ready</h3>
          <p className="text-secondary" style={{ maxWidth: '540px', margin: '0 auto 1.5rem auto', fontSize: '0.875rem' }}>
            Click <strong>"Run Cycle Detection"</strong> to execute the directed cycle algorithm on the current FalkorDB <code className="mono">txn</code> graph.
          </p>
          <button onClick={handleRunDetection} className="rt-button rt-button-primary">
            <Play size={14} />
            <span>Start Detection</span>
          </button>
        </div>
      )}

      {hasRun && candidates.length === 0 && !loading && (
        <div className="rt-card" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
          <CheckCircle2 size={36} className="text-accent-emerald" style={{ margin: '0 auto 1rem auto' }} />
          <h3 style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '0.5rem' }}>No Cycles Detected</h3>
          <p className="text-secondary" style={{ fontSize: '0.875rem' }}>
            No directed cycles meeting the criteria (length {minLength}–{maxLength}) were found within the configured limit.
          </p>
        </div>
      )}

      {candidates.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', alignItems: 'start' }}>
          {/* Left Column: Candidates List */}
          <div className="rt-card" style={{ padding: '1rem', maxHeight: '760px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Layers size={16} className="text-accent-cyan" />
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Detected Cycle Candidates</span>
                <span className="rt-badge rt-badge-cyan" style={{ fontSize: '0.7rem' }}>{candidates.length}</span>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Click to view topology</span>
            </div>

            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingRight: '4px' }}>
              {candidates.map((cand) => {
                const isSelected = selectedCycle?.cycle_id === cand.cycle_id;
                return (
                  <div
                    key={cand.cycle_id}
                    onClick={() => setSelectedCycle(cand)}
                    style={{
                      padding: '0.85rem',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: isSelected ? 'rgba(14, 165, 233, 0.12)' : 'var(--bg-tertiary)',
                      border: isSelected ? '1px solid var(--accent-cyan)' : '1px solid var(--border-color)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                      <span className="mono" style={{ fontWeight: 700, fontSize: '0.85rem', color: isSelected ? 'var(--accent-cyan)' : 'var(--text-primary)' }}>
                        {cand.cycle_id}
                      </span>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.68rem' }}>
                          {cand.cycle_length} hops
                        </span>
                        <span className="rt-badge rt-badge-rose" style={{ fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '2px' }}>
                          <Clock size={10} /> Time-Ordered
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                      {cand.accounts.map((acc) => (
                        <React.Fragment key={acc}>
                          <span className="mono" style={{ color: 'var(--text-primary)' }}>{acc}</span>
                          <ArrowRight size={11} className="text-secondary" />
                        </React.Fragment>
                      ))}
                      <span className="mono" style={{ color: 'var(--accent-cyan)' }}>{cand.accounts[0]}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      <span>Total Flow: <strong style={{ color: 'var(--text-primary)' }}>${(cand.total_flow || cand.total_amount).toLocaleString()}</strong></span>
                      <span>Retention: <strong style={{ color: 'var(--text-primary)' }}>{((cand.retention || cand.amount_conservation_ratio) * 100).toFixed(1)}%</strong></span>
                      <span>Span: {Math.round((cand.time_span || cand.duration_seconds) / 3600)}h</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Selected Cycle Evidence & Cytoscape Graph */}
          {selectedCycle && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Cytoscape Visualizer Card */}
              <div className="rt-card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ShieldAlert size={16} className="text-accent-cyan" />
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Topology Visualization</span>
                    <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {selectedCycle.cycle_id}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Interactive circular layout</span>
                </div>

                <div
                  ref={cyContainerRef}
                  style={{
                    width: '100%',
                    height: '280px',
                    backgroundColor: 'var(--bg-primary)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                  }}
                />
              </div>

              {/* Supporting Evidence Breakdown */}
              <div className="rt-card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    Supporting Transactions ({selectedCycle.transactions.length})
                  </span>
                  <span className="rt-badge rt-badge-cyan" style={{ fontSize: '0.7rem' }}>Real Edge Evidence</span>
                </div>

                {/* Explanation text */}
                <div style={{
                  padding: '0.75rem',
                  backgroundColor: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  lineHeight: '1.4',
                  marginBottom: '1rem',
                  borderLeft: '3px solid var(--accent-cyan)'
                }}>
                  {selectedCycle.explanation}
                </div>

                {/* Derived Metrics Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem', marginBottom: '1rem' }}>
                  <div style={{ padding: '0.5rem', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>TOTAL FLOW</div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>${(selectedCycle.total_flow || selectedCycle.total_amount).toLocaleString()}</div>
                  </div>
                  <div style={{ padding: '0.5rem', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>RETENTION</div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#10b981' }}>{((selectedCycle.retention || selectedCycle.amount_conservation_ratio) * 100).toFixed(1)}%</div>
                  </div>
                  <div style={{ padding: '0.5rem', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>TIME SPAN</div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{Math.round((selectedCycle.time_span || selectedCycle.duration_seconds) / 3600)}h</div>
                  </div>
                </div>

                {/* Transaction details table */}
                <div style={{ overflowX: 'auto' }}>
                  <table className="rt-table" style={{ width: '100%', fontSize: '0.78rem' }}>
                    <thead>
                      <tr>
                        <th>Hop</th>
                        <th>Sender</th>
                        <th></th>
                        <th>Receiver</th>
                        <th>Amount</th>
                        <th>Channel</th>
                        <th>Tx ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedCycle.transactions.map((tx, idx) => (
                        <tr key={tx.tx_id}>
                          <td>
                            <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.68rem' }}>
                              #{idx + 1}
                            </span>
                          </td>
                          <td>
                            <button
                              onClick={() => onInspectAccount(tx.src)}
                              className="mono"
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--accent-cyan)',
                                cursor: 'pointer',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '2px',
                                fontSize: '0.78rem'
                              }}
                            >
                              {tx.src}
                              <ExternalLink size={10} />
                            </button>
                          </td>
                          <td style={{ color: 'var(--text-secondary)' }}>→</td>
                          <td>
                            <button
                              onClick={() => onInspectAccount(tx.dst)}
                              className="mono"
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--accent-cyan)',
                                cursor: 'pointer',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '2px',
                                fontSize: '0.78rem'
                              }}
                            >
                              {tx.dst}
                              <ExternalLink size={10} />
                            </button>
                          </td>
                          <td style={{ fontWeight: 600 }}>${tx.amount.toLocaleString()}</td>
                          <td>
                            <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.68rem' }}>
                              {tx.tx_type}
                            </span>
                          </td>
                          <td className="mono" style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
                            {tx.tx_id}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

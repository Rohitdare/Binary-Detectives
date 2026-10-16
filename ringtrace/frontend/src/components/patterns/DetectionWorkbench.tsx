import React, { useCallback, useEffect, useRef, useState } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import { AlertTriangle, CheckCircle2, CircleDashed, GitBranch, Network, Play, RotateCcw } from 'lucide-react';
import type { CycleCandidate, DetectorHit, DetectorPattern, DetectorRunSummary, DetectorTransaction } from '../../types';
import { ringtraceApi } from '../../services/api';

interface WorkbenchHit {
  id: string;
  pattern: DetectorPattern;
  accounts: string[];
  transactions: DetectorTransaction[];
  measurements: Record<string, unknown>;
  suspicious: boolean;
  explanation: string;
}

interface DetectionWorkbenchProps {
  requestedPattern: DetectorPattern | null;
  onInspectAccount: (accountId: string) => void;
  onRunStatus: (pattern: DetectorPattern, summary: DetectorRunSummary) => void;
  onRequestHandled: () => void;
}

const TITLES: Record<DetectorPattern, string> = { cycle: 'Cycle', fan_in: 'Fan-in', fan_out: 'Fan-out' };
const ICONS = { cycle: CircleDashed, fan_in: GitBranch, fan_out: Network };
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const dateTime = (seconds: number) => new Date(seconds * 1000).toLocaleString();

function cycleToHit(hit: CycleCandidate): WorkbenchHit {
  return {
    id: hit.cycle_id,
    pattern: 'cycle',
    accounts: hit.accounts,
    transactions: hit.transactions,
    measurements: {
      cycle_length: hit.cycle_length,
      duration_seconds: hit.duration_seconds,
      retention: hit.retention,
      amount_conservation_ratio: hit.amount_conservation_ratio,
      total_amount: hit.total_flow,
    },
    suspicious: Boolean(hit.suspicious),
    explanation: hit.explanation,
  };
}

function apiHitToWorkbenchHit(hit: DetectorHit): WorkbenchHit {
  return {
    id: hit.hit_id,
    pattern: hit.pattern,
    accounts: hit.account_ids,
    transactions: hit.transactions,
    measurements: hit.measurements,
    suspicious: Boolean(hit.measurements.suspicious),
    explanation: hit.explanation,
  };
}

export const DetectionWorkbench: React.FC<DetectionWorkbenchProps> = ({ requestedPattern, onInspectAccount, onRunStatus, onRequestHandled }) => {
  const [pattern, setPattern] = useState<DetectorPattern>('cycle');
  const [hits, setHits] = useState<WorkbenchHit[]>([]);
  const [selected, setSelected] = useState<WorkbenchHit | null>(null);
  const [selectedTx, setSelectedTx] = useState<DetectorTransaction | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<DetectorRunSummary | null>(null);
  const [truncationReason, setTruncationReason] = useState<string | null>(null);
  const [cycleLength, setCycleLength] = useState<'3-5' | '3' | '4' | '5'>('3-5');
  const graphContainer = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const autoRunRequested = useRef<DetectorPattern | null>(null);

  const run = useCallback(async (target: DetectorPattern) => {
    setPattern(target);
    setLoading(true);
    setHasRun(false);
    setError(null);
    setSelected(null);
    setSelectedTx(null);
    setHits([]);
    setRunSummary(null);
    setTruncationReason(null);
    onRunStatus(target, { status: 'running', hits: 0, suspicious: 0 });
    const started = performance.now();
    try {
      let nextHits: WorkbenchHit[];
      let truncated = false;
      let reason: string | null = null;
      let measuredTime: number;
      let edgesScanned: number | undefined;
      let searchSteps: number | undefined;
      if (target === 'cycle') {
        const [minLength, maxLength] = cycleLength === '3-5' ? [3, 5] : [Number(cycleLength), Number(cycleLength)];
        const response = await ringtraceApi.detectCycles(minLength, maxLength, 50);
        nextHits = response.cycles.map(cycleToHit);
        truncated = response.truncated;
        reason = response.truncation_reason;
        measuredTime = response.execution_time_ms ?? performance.now() - started;
        edgesScanned = response.edges_scanned;
        searchSteps = response.search_steps;
      } else {
        const response = target === 'fan_in'
          ? await ringtraceApi.detectFanIn()
          : await ringtraceApi.detectFanOut();
        nextHits = (response.hits ?? []).map(apiHitToWorkbenchHit);
        truncated = response.truncated;
        reason = response.truncation_reason;
        measuredTime = response.execution_time_ms;
      }
      const summary: DetectorRunSummary = {
        status: 'completed',
        hits: nextHits.length,
        suspicious: nextHits.filter((hit) => hit.suspicious).length,
        execution_time_ms: measuredTime,
        edges_scanned: edgesScanned,
        search_steps: searchSteps,
        truncated,
      };
      setHits(nextHits);
      setSelected(nextHits[0] ?? null);
      setHasRun(true);
      setTruncationReason(reason);
      setRunSummary(summary);
      onRunStatus(target, summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Detector request failed.';
      setError(message);
      setHasRun(true);
      const summary: DetectorRunSummary = { status: 'failed', hits: 0, suspicious: 0, error: message };
      setRunSummary(summary);
      onRunStatus(target, summary);
    } finally {
      setLoading(false);
    }
  }, [cycleLength, onRunStatus]);

  const runRef = useRef(run);
  useEffect(() => { runRef.current = run; }, [run]);
  useEffect(() => {
    if (!requestedPattern) {
      autoRunRequested.current = null;
    } else if (autoRunRequested.current !== requestedPattern) {
      autoRunRequested.current = requestedPattern;
      void runRef.current(requestedPattern);
      onRequestHandled();
    }
  }, [requestedPattern, onRequestHandled]);

  useEffect(() => {
    if (!graphContainer.current || !selected) return;
    cyRef.current?.destroy();
    const hub = selected.pattern === 'fan_in' || selected.pattern === 'fan_out' ? selected.accounts[0] : null;
    const nodes: cytoscape.ElementDefinition[] = selected.accounts.map((id, index) => ({ data: { id, label: id, hub: id === hub, sequence: index } }));
    const edges: cytoscape.ElementDefinition[] = selected.transactions.map((tx, index) => ({
        data: { id: tx.tx_id, source: tx.src, target: tx.dst, label: currency.format(tx.amount), txId: tx.tx_id, amount: tx.amount, ts: tx.ts, channel: tx.tx_type, sequence: index },
      }));
    const elements = [...nodes, ...edges];
    const cy = cytoscape({
      container: graphContainer.current,
      elements,
      style: [
        { selector: 'node', style: { label: 'data(label)', color: '#e2e8f0', 'font-size': 10, 'font-family': 'ui-monospace, monospace', 'text-valign': 'bottom', 'text-margin-y': 6, 'background-color': '#334155', 'border-width': 2, 'border-color': '#38bdf8', width: 34, height: 34 } },
        { selector: 'node[?hub]', style: { 'background-color': '#0e7490', 'border-color': '#67e8f9', width: 42, height: 42 } },
        { selector: 'edge', style: { label: 'data(label)', color: '#94a3b8', 'font-size': 8, 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#38bdf8', 'line-color': '#0284c7', width: 2, 'arrow-scale': 1.1, 'text-background-color': '#0b1220', 'text-background-opacity': 0.9, 'text-background-padding': '2px', 'text-rotation': 'autorotate' } },
        { selector: 'edge.selected', style: { 'line-color': '#fbbf24', 'target-arrow-color': '#fbbf24', width: 5, color: '#fef3c7', 'font-weight': 'bold' } },
      ],
      layout: { name: selected.pattern === 'cycle' ? 'circle' : 'concentric', padding: 36, animate: false },
      userZoomingEnabled: true,
      userPanningEnabled: true,
    });
    cy.on('tap', 'edge', (event) => {
      const data = event.target.data();
      setSelectedTx({ tx_id: String(data.txId), src: String(data.source), dst: String(data.target), amount: Number(data.amount), ts: Number(data.ts), tx_type: String(data.channel) });
    });
    cy.on('tap', 'node', (event) => onInspectAccount(String(event.target.id())));
    cyRef.current = cy;
    return () => { cy.destroy(); if (cyRef.current === cy) cyRef.current = null; };
  }, [selected, onInspectAccount]);

  useEffect(() => {
    cyRef.current?.edges().removeClass('selected');
    if (selectedTx) cyRef.current?.getElementById(selectedTx.tx_id).addClass('selected');
  }, [selectedTx]);

  const selectHit = (hit: WorkbenchHit) => {
    setSelected(hit);
    setSelectedTx(null);
  };
  const Icon = ICONS[pattern];
  const measures = selected ? Object.entries(selected.measurements).filter(([key, value]) => key !== 'suspicious' && value !== null && typeof value !== 'boolean') : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <header className="rt-card" style={{ padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Icon size={20} className="text-accent-cyan" />
            <div>
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>{TITLES[pattern]} detection</h2>
              <div className="text-secondary" style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>Every result below comes from the selected detector and includes its transaction evidence.</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {pattern === 'cycle' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.76rem' }}>
                Hops
                <select aria-label="Cycle length" value={cycleLength} onChange={(event) => setCycleLength(event.target.value as typeof cycleLength)} className="rt-input">
                  <option value="3-5">3 to 5</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>
                </select>
              </label>
            )}
            <button className="rt-button rt-button-primary" onClick={() => void run(pattern)} disabled={loading}>
              {loading ? <RotateCcw size={14} className="spin" /> : <Play size={13} />}
              {loading ? 'Running detector…' : hasRun ? 'Run again' : `Run ${TITLES[pattern]} detector`}
            </button>
          </div>
        </div>
        {loading && <p aria-live="polite" className="text-secondary" style={{ margin: '0.8rem 0 0', fontSize: '0.78rem' }}>Searching transaction history and checking time and amount patterns. The API reports elapsed time when the run finishes; no progress percentage is estimated.</p>}
        {runSummary && !loading && <div aria-live="polite" style={{ marginTop: '0.65rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          {runSummary.status === 'completed' ? `Completed in ${((runSummary.execution_time_ms ?? 0) / 1000).toFixed(2)}s · ${runSummary.hits} candidates · ${runSummary.suspicious} need review${pattern === 'cycle' ? ` · ${runSummary.edges_scanned ?? 0} edges scanned · ${runSummary.search_steps ?? 0} path steps` : ''}` : `Last run failed: ${runSummary.error}`}
        </div>}
      </header>

      {error && <div role="alert" className="rt-card" style={{ padding: '0.85rem 1rem', borderColor: 'rgba(244,63,94,.4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
        <span style={{ color: 'var(--accent-rose)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><AlertTriangle size={16} />{error}</span>
        <button className="rt-button" onClick={() => void run(pattern)}>Retry</button>
      </div>}

      {truncationReason && <div className="rt-card" style={{ padding: '0.75rem 1rem', borderColor: 'rgba(245,158,11,.4)', color: 'var(--accent-amber)', fontSize: '0.78rem' }}>
        Results were capped ({truncationReason}). Review this partial result; an empty partial result does not mean the graph has no matching activity.
      </div>}

      {hasRun && !error && hits.length === 0 && <div className="rt-card" style={{ padding: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
        <CheckCircle2 size={18} className="text-accent-cyan" />
        <div><strong>No candidates returned by this run.</strong><p className="text-secondary" style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>This result only describes the selected detector and its current thresholds; it does not prove that no suspicious activity exists.</p></div>
      </div>}
      {hasRun && hits.length > 0 && runSummary?.suspicious === 0 && <div className="rt-card" style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>Candidates were found, but none met this detector's current review criteria. They remain available below as pattern evidence.</div>}
      {!hasRun && !loading && <div className="rt-card" style={{ padding: '1.25rem', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Choose a detector card from Overview to start, or run the selected detector here.</div>}

      {hits.length > 0 && <div className="detection-workbench-grid">
        <section className="rt-card" style={{ padding: '0.8rem', minWidth: 0 }} aria-label="Detection candidates">
          <h3 style={{ fontSize: '0.84rem', margin: '0 0 0.65rem' }}>Candidates ({hits.length})</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '670px', overflowY: 'auto' }}>
            {hits.map((hit) => <button key={hit.id} onClick={() => selectHit(hit)} className="detection-hit-button" aria-pressed={selected?.id === hit.id}>
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: '0.4rem', alignItems: 'center' }}>
                <strong className="mono" style={{ fontSize: '0.72rem' }}>{hit.id}</strong>
                <span className={`rt-badge ${hit.suspicious ? 'rt-badge-rose' : 'rt-badge-gray'}`}>{hit.suspicious ? 'Needs review' : 'Pattern only'}</span>
              </span>
              <span className="text-secondary" style={{ display: 'block', marginTop: '0.45rem', fontSize: '0.72rem' }}>{hit.accounts.length} accounts · {hit.transactions.length} transactions</span>
            </button>)}
          </div>
        </section>

        <section className="rt-card" style={{ padding: '0.8rem', minWidth: 0 }} aria-label="Transaction flow graph">
          <h3 style={{ fontSize: '0.84rem', margin: '0 0 0.25rem' }}>Money flow <span className="text-secondary" style={{ fontWeight: 400 }}>· select an edge for details, a node to inspect the account</span></h3>
          <div ref={graphContainer} className="detection-graph" />
        </section>

        <section className="rt-card" style={{ padding: '0.9rem', minWidth: 0 }} aria-label="Selected evidence">
          {selected && <>
            <span className={`rt-badge ${selected.suspicious ? 'rt-badge-rose' : 'rt-badge-gray'}`}>{selected.suspicious ? 'Needs review' : 'Pattern candidate'}</span>
            <p style={{ fontSize: '0.79rem', lineHeight: 1.5, margin: '0.65rem 0' }}>{selected.explanation}</p>
            {measures.length > 0 && <div className="detection-measures">
              {measures.map(([key, value]) => <div key={key}><span className="text-secondary">{key.replaceAll('_', ' ')}</span><strong>{typeof value === 'number' && key.includes('share') || key === 'retention' || key === 'amount_conservation_ratio' ? `${(Number(value) * 100).toFixed(1)}%` : typeof value === 'number' && /amount|flow|outflow/.test(key) ? currency.format(value) : String(value)}</strong></div>)}
            </div>}
            {selectedTx && <div className="detection-selected-tx" aria-live="polite">
              <strong>Selected transaction</strong>
              <div className="mono" style={{ fontSize: '0.72rem', marginTop: '0.25rem' }}>{selectedTx.tx_id}</div>
              <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>{selectedTx.src} → {selectedTx.dst} · {currency.format(selectedTx.amount)}</div>
              <div className="text-secondary" style={{ fontSize: '0.7rem' }}>{dateTime(selectedTx.ts)} · {selectedTx.tx_type}</div>
            </div>}
            <div style={{ marginTop: '0.8rem', fontSize: '0.75rem', fontWeight: 600 }}>Evidence transactions ({selected.transactions.length})</div>
            <div style={{ overflow: 'auto', maxHeight: '360px', marginTop: '0.35rem' }}>
              <table className="rt-table detection-tx-table"><thead><tr><th>Flow</th><th>Amount and time</th></tr></thead><tbody>
                {selected.transactions.map((tx) => <tr key={tx.tx_id} onClick={() => setSelectedTx(tx)} style={{ cursor: 'pointer', background: selectedTx?.tx_id === tx.tx_id ? 'rgba(251,191,36,.08)' : undefined }}>
                  <td><button className="account-link" onClick={(event) => { event.stopPropagation(); onInspectAccount(tx.src); }}>{tx.src}</button><span aria-hidden="true"> → </span><button className="account-link" onClick={(event) => { event.stopPropagation(); onInspectAccount(tx.dst); }}>{tx.dst}</button><div className="mono text-secondary" style={{ fontSize: '0.65rem' }}>{tx.tx_id}</div></td>
                  <td>{currency.format(tx.amount)}<div className="text-secondary" style={{ fontSize: '0.68rem' }}>{dateTime(tx.ts)} · {tx.tx_type}</div></td>
                </tr>)}
              </tbody></table>
            </div>
          </>}
          <div className="text-secondary" style={{ fontSize: '0.67rem', marginTop: '0.8rem' }}>A pattern match is an investigation lead. It is not a fraud finding or probability score.</div>
        </section>
      </div>}
    </div>
  );
};

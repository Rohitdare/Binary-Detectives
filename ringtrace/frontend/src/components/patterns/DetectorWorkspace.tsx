import React, { useState } from 'react';
import {
  ArrowLeft,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  SlidersHorizontal,
  Layers,
  Database,
  Cpu,
} from 'lucide-react';
import type {
  CycleEvaluationReport,
  DetectorPattern,
  DetectorRunSummary,
  DetectorTransaction,
} from '../../types';
import type { WorkbenchCandidate } from './types';
import { DETECTOR_CATALOG } from './catalogData';
import { CandidateList } from './CandidateList';
import { CandidateGraph } from './CandidateGraph';
import { CandidateEvidencePanel } from './CandidateEvidencePanel';
import { CandidateIdInfo } from './CandidateIdInfo';

export interface DetectorExecutionOptions {
  cycleHopRange?: '3-5' | '3' | '4' | '5';
  cycleLength?: '3-5' | '3' | '4' | '5';
  bipartitePreset?: 'standard' | 'broad' | 'strict';
  clusterPreset?: 'standard' | 'dense' | 'extreme';
  hubPreset?: 'standard' | 'broad' | 'extreme';
}

interface DetectorWorkspaceProps {
  pattern: DetectorPattern;
  candidates: WorkbenchCandidate[];
  summary: DetectorRunSummary | undefined;
  isRunning: boolean;
  error: string | null;
  truncationReason: string | null;
  onBackToCatalog: () => void;
  onExecute: (
    pattern: DetectorPattern,
    options?: '3-5' | '3' | '4' | '5' | DetectorExecutionOptions
  ) => Promise<void>;
  onInspectAccount: (accountId: string) => void;
  // Cycle specific evaluation
  evaluation?: CycleEvaluationReport | null;
  evaluating?: boolean;
  evaluationError?: string | null;
  onEvaluateCycles?: () => Promise<void>;
}

export const DetectorWorkspace: React.FC<DetectorWorkspaceProps> = ({
  pattern,
  candidates,
  summary,
  isRunning,
  error,
  truncationReason,
  onBackToCatalog,
  onExecute,
  onInspectAccount,
  evaluation,
  evaluating,
  evaluationError,
  onEvaluateCycles,
}) => {
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<DetectorTransaction | null>(null);
  const [cycleLength, setCycleLength] = useState<'3-5' | '3' | '4' | '5'>('3-5');
  const [bipartitePreset, setBipartitePreset] = useState<'standard' | 'broad' | 'strict'>('standard');
  const [clusterPreset, setClusterPreset] = useState<'standard' | 'dense' | 'extreme'>('standard');
  const [hubPreset, setHubPreset] = useState<'standard' | 'broad' | 'extreme'>('standard');

  const selectedCandidate =
    (selectedCandidateId ? candidates.find((c) => c.id === selectedCandidateId) : null) ??
    candidates[0] ??
    null;

  const detectorMeta = DETECTOR_CATALOG.find((d) => d.id === pattern) ?? {
    id: pattern,
    name: pattern.replace('_', ' ').toUpperCase(),
    tag: 'Graph Pattern',
    explanation: 'Detects suspicious transaction graph typologies.',
    icon: Layers,
    isLive: true,
  };

  const IconComponent = detectorMeta.icon;

  const handleRun = () => {
    if (isRunning) return;
    void onExecute(pattern, {
      cycleHopRange: cycleLength,
      bipartitePreset,
      clusterPreset,
      hubPreset,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Workspace Header & Action Toolbar */}
      <div
        className="rt-card"
        style={{
          padding: '1.25rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        {/* Navigation & Title row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <button
              onClick={onBackToCatalog}
              className="rt-button rt-button-sm"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
              }}
              title="Return to Detector Catalog"
            >
              <ArrowLeft size={13} />
              <span>Back to Catalog</span>
            </button>

            <div style={{ width: '1px', height: '18px', backgroundColor: 'var(--border-subtle)' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: '#F1F5F9',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid #E2E8F0',
                }}
              >
                <IconComponent size={16} color="#0F172A" />
              </div>
              <h2
                style={{
                  fontSize: '1.15rem',
                  fontWeight: 700,
                  color: '#0F172A',
                  margin: 0,
                  letterSpacing: '-0.01em',
                }}
              >
                {detectorMeta.name}
              </h2>
              <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.65rem' }}>
                {detectorMeta.tag}
              </span>
            </div>
          </div>

          {/* Action Button & Info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            {pattern === 'cycle' && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <span>Hops:</span>
                <select
                  value={cycleLength}
                  onChange={(e) => {
                    const nextVal = e.target.value as typeof cycleLength;
                    setCycleLength(nextVal);
                    if (pattern === 'cycle' && !isRunning) {
                      void onExecute('cycle', nextVal);
                    }
                  }}
                  className="rt-input"
                  style={{
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                  }}
                  disabled={isRunning}
                  aria-label="Cycle hops range"
                >
                  <option value="3-5">3 to 5 hops (All)</option>
                  <option value="3">3 hops</option>
                  <option value="4">4 hops</option>
                  <option value="5">5 hops</option>
                </select>
              </label>
            )}

            {pattern === 'bipartite' && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <span>Matrix:</span>
                <select
                  value={bipartitePreset}
                  onChange={(e) => {
                    const nextVal = e.target.value as typeof bipartitePreset;
                    setBipartitePreset(nextVal);
                    if (pattern === 'bipartite' && !isRunning) {
                      void onExecute('bipartite', { bipartitePreset: nextVal });
                    }
                  }}
                  className="rt-input"
                  style={{
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                  }}
                  disabled={isRunning}
                  aria-label="Bipartite matrix size"
                >
                  <option value="standard">3x3 (Standard)</option>
                  <option value="broad">2x2 (Broad Search)</option>
                  <option value="strict">4x4 (Strict Large)</option>
                </select>
              </label>
            )}

            {pattern === 'dense_cluster' && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <span>Density:</span>
                <select
                  value={clusterPreset}
                  onChange={(e) => {
                    const nextVal = e.target.value as typeof clusterPreset;
                    setClusterPreset(nextVal);
                    if (pattern === 'dense_cluster' && !isRunning) {
                      void onExecute('dense_cluster', { clusterPreset: nextVal });
                    }
                  }}
                  className="rt-input"
                  style={{
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                  }}
                  disabled={isRunning}
                  aria-label="Dense cluster density threshold"
                >
                  <option value="standard">≥10% (Balanced)</option>
                  <option value="dense">≥20% (High Density)</option>
                  <option value="extreme">≥30% (Tight Core)</option>
                </select>
              </label>
            )}

            {pattern === 'hub_account' && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <span>Sensitivity:</span>
                <select
                  value={hubPreset}
                  onChange={(e) => {
                    const nextVal = e.target.value as typeof hubPreset;
                    setHubPreset(nextVal);
                    if (pattern === 'hub_account' && !isRunning) {
                      void onExecute('hub_account', { hubPreset: nextVal });
                    }
                  }}
                  className="rt-input"
                  style={{
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                  }}
                  disabled={isRunning}
                  aria-label="Hub account outlier sensitivity"
                >
                  <option value="standard">3.0σ (Outlier Hubs)</option>
                  <option value="broad">2.5σ (Broad Search)</option>
                  <option value="extreme">4.0σ (Extreme Centrality)</option>
                </select>
              </label>
            )}

            {pattern === 'cycle' && onEvaluateCycles && (
              <button
                type="button"
                className="rt-button rt-button-sm"
                onClick={() => void onEvaluateCycles()}
                disabled={evaluating || isRunning}
                style={{ fontSize: '0.725rem' }}
                title="Run synthetic evaluation against isolated FalkorDB ground-truth labels"
              >
                {evaluating ? <RotateCcw size={11} className="spin" /> : null}
                <span>{evaluating ? 'Evaluating…' : 'Benchmark Evaluation'}</span>
              </button>
            )}

            <button
              onClick={handleRun}
              disabled={isRunning}
              className="rt-button rt-button-primary"
              style={{
                fontSize: '0.78rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
              }}
            >
              {isRunning ? <RotateCcw size={13} className="spin" /> : <Play size={13} />}
              <span>{isRunning ? 'Executing Graph Query…' : 'Execute Detector'}</span>
            </button>

            <CandidateIdInfo />
          </div>
        </div>

        {/* Plain-English Explanation */}
        <p
          style={{
            fontSize: '0.78rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.45,
            margin: 0,
            maxWidth: '840px',
          }}
        >
          {detectorMeta.explanation}
        </p>

        {/* Execution Summary Bar */}
        {summary && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem',
              padding: '0.65rem 0.85rem',
              backgroundColor: 'var(--surface-secondary)',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                {summary.status === 'completed' ? (
                  <>
                    <CheckCircle2 size={13} color="var(--accent-emerald)" />
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      Execution Completed
                    </span>
                  </>
                ) : summary.status === 'failed' ? (
                  <>
                    <AlertTriangle size={13} color="var(--accent-rose)" />
                    <span style={{ fontWeight: 600, color: 'var(--accent-rose)' }}>
                      Execution Failed
                    </span>
                  </>
                ) : (
                  <>
                    <RotateCcw size={13} className="spin" color="var(--accent-amber)" />
                    <span style={{ fontWeight: 600, color: 'var(--accent-amber)' }}>
                      Running…
                    </span>
                  </>
                )}
              </span>

              {summary.status === 'completed' && (
                <>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    Discovered:{' '}
                    <strong style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {summary.hits} candidate {summary.hits === 1 ? 'pattern' : 'patterns'}
                    </strong>
                  </span>

                  {summary.suspicious > 0 && (
                    <span style={{ color: 'var(--accent-amber)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {summary.suspicious} flagged for triage
                    </span>
                  )}

                  {summary.execution_time_ms !== undefined && (
                    <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <Cpu size={12} />
                      {Math.round(summary.execution_time_ms)}ms
                    </span>
                  )}

                  {summary.edges_scanned !== undefined && (
                    <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <Database size={12} />
                      {summary.edges_scanned.toLocaleString()} edges scanned
                    </span>
                  )}
                </>
              )}
            </div>

            {summary.truncated && (
              <span className="rt-badge rt-badge-amber" style={{ fontSize: '0.65rem' }}>
                Query Truncated ({truncationReason || 'Limit Reached'})
              </span>
            )}
          </div>
        )}
      </div>

      {/* Cycle Evaluation Benchmark Banner (if ran) */}
      {pattern === 'cycle' && evaluation && (
        <div
          className="rt-card"
          style={{
            padding: '0.85rem 1.25rem',
            fontSize: '0.78rem',
            backgroundColor: '#F8FAFC',
            borderColor: '#E2E8F0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, color: '#0F172A', marginBottom: '0.25rem' }}>
            <SlidersHorizontal size={14} color="#7C3AED" />
            <span>Cycle Typology Benchmark · Synthetic Ground-Truth Evaluation</span>
          </div>
          <div style={{ color: '#475569', lineHeight: 1.5 }}>
            Exact recall:{' '}
            <strong style={{ color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>
              {(evaluation.metrics.exact_recall * 100).toFixed(1)}%
            </strong>{' '}
            · Total recall:{' '}
            <strong style={{ color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>
              {(evaluation.metrics.total_recall * 100).toFixed(1)}%
            </strong>{' '}
            · Precision:{' '}
            <strong style={{ color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>
              {(evaluation.metrics.precision * 100).toFixed(1)}%
            </strong>{' '}
            · {evaluation.ground_truth_summary.planted_fraud_cycle_alerts} planted fraud cycles ·{' '}
            {evaluation.ground_truth_summary.planted_benign_look_alikes} benign look-alikes.
          </div>
        </div>
      )}

      {evaluationError && (
        <div
          role="alert"
          className="rt-card"
          style={{
            padding: '0.75rem 1.25rem',
            borderColor: 'var(--accent-red-border)',
            color: 'var(--accent-red)',
            fontSize: '0.78rem',
          }}
        >
          {evaluationError}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rt-card"
          style={{
            padding: '0.85rem 1.25rem',
            borderColor: 'var(--accent-red-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
          }}
        >
          <span style={{ color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.8rem' }}>
            <AlertTriangle size={15} />
            <span>{error}</span>
          </span>
          <button className="rt-button rt-button-sm" onClick={handleRun}>
            Retry Execution
          </button>
        </div>
      )}

      {/* Main Workspace Workspace Layout */}
      {candidates.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '360px 1fr',
            gap: '1rem',
            alignItems: 'start',
          }}
        >
          {/* Left Region: Dedicated Candidate List */}
          <div
            className="rt-card"
            style={{
              padding: '1rem',
              height: 'fit-content',
            }}
          >
            <CandidateList
              candidates={candidates}
              selectedCandidate={selectedCandidate}
              onSelectCandidate={(c) => {
                setSelectedCandidateId(c.id);
                setSelectedTx(null);
              }}
              pattern={pattern}
            />
          </div>

          {/* Right Region: Mini Graph + Evidence Inspector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {selectedCandidate && (
              <>
                {/* Mini Graph Canvas */}
                <div className="rt-card" style={{ padding: '1rem' }}>
                  <CandidateGraph
                    candidate={selectedCandidate}
                    selectedTx={selectedTx}
                    onSelectTx={setSelectedTx}
                    onInspectAccount={onInspectAccount}
                  />
                </div>

                {/* Evidence & Transaction Inspector */}
                <div className="rt-card" style={{ padding: '1rem' }}>
                  <CandidateEvidencePanel
                    candidate={selectedCandidate}
                    selectedTx={selectedTx}
                    onSelectTx={setSelectedTx}
                    onInspectAccount={onInspectAccount}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        /* Empty / Standby State */
        <div
          className="rt-card"
          style={{
            padding: '3.5rem 1.5rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.85rem',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: '#F1F5F9',
              border: '1px solid #E2E8F0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#0F172A',
            }}
          >
            <IconComponent size={24} />
          </div>

          <div style={{ maxWidth: '420px' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
              {summary?.status === 'completed'
                ? 'No Graph Matches Found'
                : 'Workspace Ready for Detection'}
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.35rem', lineHeight: 1.45 }}>
              {summary?.status === 'completed'
                ? 'The execution completed without finding any subgraph patterns matching this typology under the current graph parameters.'
                : 'Execute the detector to run openCypher pattern queries against the live transaction graph and populate candidate subgraphs for investigation.'}
            </p>
          </div>

          <button
            onClick={handleRun}
            disabled={isRunning}
            className="rt-button rt-button-primary"
            style={{ fontSize: '0.8rem', padding: '0.45rem 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            {isRunning ? <RotateCcw size={13} className="spin" /> : <Play size={13} />}
            <span>{isRunning ? 'Scanning Transaction Graph…' : 'Execute Detector Now'}</span>
          </button>
        </div>
      )}
    </div>
  );
};

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CycleEvaluationReport,
  DetectorPattern,
  DetectorRunSummary,
} from '../../types';
import { ringtraceApi } from '../../services/api';
import type { WorkbenchCandidate } from './types';
import {
  cycleToWorkbenchCandidate,
  detectorHitToWorkbenchCandidate,
} from './candidateUtils';
import { DetectorCatalog } from './DetectorCatalog';
import { DetectorWorkspace } from './DetectorWorkspace';

interface DetectionWorkbenchProps {
  requestedPattern: DetectorPattern | null;
  onInspectAccount: (accountId: string) => void;
  onRunStatus: (pattern: DetectorPattern, summary: DetectorRunSummary) => void;
  onRequestHandled: () => void;
}

export const DetectionWorkbench: React.FC<DetectionWorkbenchProps> = ({
  requestedPattern,
  onInspectAccount,
  onRunStatus,
  onRequestHandled,
}) => {
  const [activeWorkspace, setActiveWorkspace] = useState<DetectorPattern | null>(null);
  const [candidatesByPattern, setCandidatesByPattern] = useState<
    Partial<Record<DetectorPattern, WorkbenchCandidate[]>>
  >({});
  const [summariesByPattern, setSummariesByPattern] = useState<
    Partial<Record<DetectorPattern, DetectorRunSummary>>
  >({});
  const [runningPattern, setRunningPattern] = useState<DetectorPattern | null>(null);
  const [errorsByPattern, setErrorsByPattern] = useState<
    Partial<Record<DetectorPattern, string>>
  >({});
  const [truncationReasons, setTruncationReasons] = useState<
    Partial<Record<DetectorPattern, string>>
  >({});

  // Cycle Ground-Truth Benchmark state
  const [evaluation, setEvaluation] = useState<CycleEvaluationReport | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);

  const autoRunHandledRef = useRef<DetectorPattern | null>(null);

  const executeDetector = useCallback(
    async (target: DetectorPattern, cycleHopRange: '3-5' | '3' | '4' | '5' = '3-5') => {
      setRunningPattern(target);
      setErrorsByPattern((prev) => ({ ...prev, [target]: undefined }));
      setTruncationReasons((prev) => ({ ...prev, [target]: undefined }));
      onRunStatus(target, { status: 'running', hits: 0, suspicious: 0 });

      const startTime = performance.now();

      try {
        let candidates: WorkbenchCandidate[];
        let truncated = false;
        let truncationReason: string | null = null;
        let executionTimeMs: number;
        let edgesScanned: number | undefined;
        let searchSteps: number | undefined;

        if (target === 'cycle') {
          const [minLength, maxLength] =
            cycleHopRange === '3-5' ? [3, 5] : [Number(cycleHopRange), Number(cycleHopRange)];
          const response = await ringtraceApi.detectCycles(minLength, maxLength, 50);
          candidates = response.cycles.map(cycleToWorkbenchCandidate);
          truncated = response.truncated;
          truncationReason = response.truncation_reason;
          executionTimeMs = response.execution_time_ms ?? performance.now() - startTime;
          edgesScanned = response.edges_scanned;
          searchSteps = response.search_steps;
        } else if (target === 'fan_in') {
          const response = await ringtraceApi.detectFanIn();
          candidates = (response.hits ?? []).map(detectorHitToWorkbenchCandidate);
          truncated = response.truncated;
          truncationReason = response.truncation_reason;
          executionTimeMs = response.execution_time_ms;
        } else if (target === 'fan_out') {
          const response = await ringtraceApi.detectFanOut();
          candidates = (response.hits ?? []).map(detectorHitToWorkbenchCandidate);
          truncated = response.truncated;
          truncationReason = response.truncation_reason;
          executionTimeMs = response.execution_time_ms;
        } else if (target === 'relay_chain') {
          const response = await ringtraceApi.detectRelayChain();
          candidates = (response.hits ?? []).map(detectorHitToWorkbenchCandidate);
          truncated = response.truncated;
          truncationReason = response.truncation_reason;
          executionTimeMs = response.execution_time_ms;
        } else if (target === 'scatter_gather') {
          const response = await ringtraceApi.detectScatterGather();
          candidates = (response.hits ?? []).map(detectorHitToWorkbenchCandidate);
          truncated = response.truncated;
          truncationReason = response.truncation_reason;
          executionTimeMs = response.execution_time_ms;
        } else {
          const response = await ringtraceApi.detectGatherScatter();
          candidates = (response.hits ?? []).map(detectorHitToWorkbenchCandidate);
          truncated = response.truncated;
          truncationReason = response.truncation_reason;
          executionTimeMs = response.execution_time_ms;
        }

        const suspiciousCount = candidates.filter((c) => c.suspicious).length;
        const summary: DetectorRunSummary = {
          status: 'completed',
          hits: candidates.length,
          suspicious: suspiciousCount,
          execution_time_ms: executionTimeMs,
          edges_scanned: edgesScanned,
          search_steps: searchSteps,
          truncated,
        };

        setCandidatesByPattern((prev) => ({ ...prev, [target]: candidates }));
        setSummariesByPattern((prev) => ({ ...prev, [target]: summary }));
        if (truncationReason) {
          setTruncationReasons((prev) => ({ ...prev, [target]: truncationReason }));
        }
        onRunStatus(target, summary);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Detector execution failed';
        setErrorsByPattern((prev) => ({ ...prev, [target]: message }));
        const failSummary: DetectorRunSummary = {
          status: 'failed',
          hits: 0,
          suspicious: 0,
          error: message,
        };
        setSummariesByPattern((prev) => ({ ...prev, [target]: failSummary }));
        onRunStatus(target, failSummary);
      } finally {
        setRunningPattern(null);
      }
    },
    [onRunStatus]
  );

  const evaluateCycles = useCallback(async () => {
    setEvaluating(true);
    setEvaluationError(null);
    try {
      const report = await ringtraceApi.evaluateCycles();
      setEvaluation(report);
    } catch (err: unknown) {
      setEvaluationError(
        err instanceof Error ? err.message : 'Cycle ground-truth evaluation failed.'
      );
    } finally {
      setEvaluating(false);
    }
  }, []);

  // Handle external requestedPattern navigation
  const executeRef = useRef(executeDetector);
  useEffect(() => {
    executeRef.current = executeDetector;
  }, [executeDetector]);

  useEffect(() => {
    if (!requestedPattern) {
      autoRunHandledRef.current = null;
    } else if (autoRunHandledRef.current !== requestedPattern) {
      autoRunHandledRef.current = requestedPattern;
      setActiveWorkspace(requestedPattern);
      if (!candidatesByPattern[requestedPattern]) {
        void executeRef.current(requestedPattern);
      }
      onRequestHandled();
    }
  }, [requestedPattern, candidatesByPattern, onRequestHandled]);

  // Candidate counts mapping for catalog
  const candidateCounts: Partial<Record<DetectorPattern, number>> = {};
  for (const [key, candidates] of Object.entries(candidatesByPattern)) {
    if (candidates) {
      candidateCounts[key as DetectorPattern] = candidates.length;
    }
  }

  return (
    <div style={{ width: '100%', maxWidth: '1440px', margin: '0 auto' }}>
      {activeWorkspace === null ? (
        /* Level A: Detector Catalog */
        <DetectorCatalog
          summaries={summariesByPattern}
          candidateCounts={candidateCounts}
          runningPattern={runningPattern}
          onOpenWorkspace={(pattern) => setActiveWorkspace(pattern)}
        />
      ) : (
        /* Level B: Dedicated Detector Workspace */
        <DetectorWorkspace
          pattern={activeWorkspace}
          candidates={candidatesByPattern[activeWorkspace] ?? []}
          summary={summariesByPattern[activeWorkspace]}
          isRunning={runningPattern === activeWorkspace}
          error={errorsByPattern[activeWorkspace] ?? null}
          truncationReason={truncationReasons[activeWorkspace] ?? null}
          onBackToCatalog={() => setActiveWorkspace(null)}
          onExecute={executeDetector}
          onInspectAccount={onInspectAccount}
          evaluation={activeWorkspace === 'cycle' ? evaluation : undefined}
          evaluating={evaluating}
          evaluationError={evaluationError}
          onEvaluateCycles={activeWorkspace === 'cycle' ? evaluateCycles : undefined}
        />
      )}
    </div>
  );
};

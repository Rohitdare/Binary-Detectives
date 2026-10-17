import React, { useEffect, useState, useRef } from 'react';
import {
  FileSearch,
  Bot,
  ShieldAlert,
  Play,
  RotateCcw,
  Sparkles,
  Cpu,
  ChevronDown,
  ChevronRight,
  Terminal,
  AlertCircle,
  FileText,
  BadgeAlert
} from 'lucide-react';
import { ringtraceApi } from '../../services/api';
import { DecisionBar } from './DecisionBar';
import { MemoryPanel } from './MemoryPanel';
import { DemoControls } from './DemoControls';
import { MarkdownViewer } from './MarkdownViewer';
import type {
  CaseRecord,
  DecisionRecord,
  InvestigationAssessment,
  InvestigationStep,
  ProposedAction
} from '../../types';

export interface InvestigationPanelProps {
  initialCaseId?: string;
  onInspectAccount?: (accountId: string) => void;
}

export type InvestigationMode = 'pending' | 'running' | 'llm' | 'fallback';

/**
 * InvestigationPanel is the primary Member B autonomous agent cockpit.
 * It connects to the FastAPI SSE stream (/api/v1/investigations/{id}/events)
 * using new EventSource(...) and streams live tool executions, anti-hallucination
 * validations, and final structured narrative findings.
 */
export const InvestigationPanel: React.FC<InvestigationPanelProps> = ({
  initialCaseId = 'CASE_0001',
  onInspectAccount = () => {},
}) => {
  const [selectedCaseId, setSelectedCaseId] = useState(initialCaseId);
  const [customCaseId, setCustomCaseId] = useState('');
  const [investigationId, setInvestigationId] = useState<string | null>(null);

  // Live cases from backend
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [loadingCases, setLoadingCases] = useState(true);

  // Stream state
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<InvestigationStep[]>([]);
  const [assessment, setAssessment] = useState<InvestigationAssessment | null>(null);
  const [proposedAction, setProposedAction] = useState<ProposedAction | null>(null);
  const [mode, setMode] = useState<InvestigationMode>('pending');
  const [streamError, setStreamError] = useState<string | null>(null);
  const [caseStatus, setCaseStatus] = useState('open');
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const stepsEndRef = useRef<HTMLDivElement | null>(null);

  const activeCaseId = customCaseId.trim() || selectedCaseId;

  // Fetch live cases on mount and on refresh
  useEffect(() => {
    let isMounted = true;
    setLoadingCases(true);
    ringtraceApi
      .getCases({ limit: 100 })
      .then((res) => {
        if (isMounted) {
          const items = res.items || [];
          setCases(items);
          if (items.length > 0) {
            // Keep current selection if valid, or default to initialCaseId or first case
            const exists = items.some((c) => c.case_id === selectedCaseId);
            if (!exists) {
              const hasInitial = items.some((c) => c.case_id === initialCaseId);
              setSelectedCaseId(hasInitial ? initialCaseId : items[0].case_id);
            }
          }
        }
      })
      .catch((err) => {
        console.error('Failed to fetch live cases from GET /api/v1/cases', err);
      })
      .finally(() => {
        if (isMounted) setLoadingCases(false);
      });

    return () => {
      isMounted = false;
    };
  }, [refreshTrigger, initialCaseId]);

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Auto-scroll tool logs
  useEffect(() => {
    if (stepsEndRef.current && isRunning) {
      stepsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [steps, isRunning]);

  const toggleStepExpand = (idx: number) => {
    setExpandedSteps((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const startInvestigation = async () => {
    if (!activeCaseId) return;

    // Reset current state
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setIsRunning(true);
    setSteps([]);
    setAssessment(null);
    setProposedAction(null);
    setStreamError(null);
    setMode('running');

    try {
      // 1. Trigger agent loop via POST /api/v1/cases/{id}/investigations
      const startRes = await ringtraceApi.startInvestigation(activeCaseId);
      const invId = startRes.investigation_id;
      setInvestigationId(invId);

      // 2. Open real-time Server-Sent Events (SSE) feed
      const sseUrl = `/api/v1/investigations/${encodeURIComponent(invId)}/events`;
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.addEventListener('step', (event: MessageEvent) => {
        try {
          const stepData = JSON.parse(event.data);
          setSteps((prev) => [...prev, stepData]);
          setMode('running');
        } catch (e) {
          console.error('Failed to parse SSE step data', e);
        }
      });

      es.addEventListener('done', (event: MessageEvent) => {
        try {
          const doneData = JSON.parse(event.data);
          if (doneData.mode === 'fallback') {
            setMode('fallback');
          } else if (doneData.mode === 'llm') {
            setMode('llm');
          } else {
            setMode('fallback');
          }
          if (doneData.assessment) setAssessment(doneData.assessment);
          if (doneData.proposed_action) setProposedAction(doneData.proposed_action);
          setIsRunning(false);
          es.close();
        } catch (e) {
          console.error('Failed to parse SSE done data', e);
          setMode('fallback');
          setIsRunning(false);
          es.close();
        }
      });

      es.addEventListener('error', (event: MessageEvent) => {
        try {
          if (event.data) {
            const errData = JSON.parse(event.data);
            setStreamError(errData.message || 'Investigation error encountered');
          }
        } catch {
          // General network disconnection or closed stream
        }
        setMode('fallback');
        setIsRunning(false);
        es.close();
      });

      es.onerror = () => {
        // Fallback or stream completion check
        setMode((prev) => (prev === 'running' ? 'fallback' : prev));
        setIsRunning(false);
        es.close();
      };
    } catch (err: any) {
      setStreamError(err?.message || 'Failed to start autonomous investigation.');
      setMode('fallback');
      setIsRunning(false);
    }
  };

  const handleDecisionRecorded = (decRecord: DecisionRecord | null) => {
    if (decRecord) {
      const statusMap: Record<string, string> = {
        escalate: 'escalated',
        monitor: 'monitoring',
        dismiss: 'dismissed',
        draft_sar: 'sar_drafted',
      };
      setCaseStatus(statusMap[decRecord.decision] || decRecord.decision);
      if (proposedAction) {
        setProposedAction((prev) => (prev ? { ...prev, status: 'approved' } : null));
      }
    }
    setRefreshTrigger((prev) => prev + 1);
  };

  const renderRiskBadge = (level?: string) => {
    const l = (level || '').toLowerCase();
    if (l === 'high') {
      return (
        <span className="rt-badge rt-badge-rose" style={{ fontSize: '0.75rem', fontWeight: 600 }}>
          <BadgeAlert size={12} />
          HIGH RISK
        </span>
      );
    }
    if (l === 'medium') {
      return (
        <span className="rt-badge rt-badge-amber" style={{ fontSize: '0.75rem', fontWeight: 600 }}>
          <ShieldAlert size={12} />
          MEDIUM RISK
        </span>
      );
    }
    return (
      <span className="rt-badge rt-badge-emerald" style={{ fontSize: '0.75rem', fontWeight: 600 }}>
        <Bot size={12} />
        LOW RISK
      </span>
    );
  };

  const renderModeBadge = () => {
    switch (mode) {
      case 'llm':
        return (
          <span
            className="rt-badge rt-badge-emerald"
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
            }}
          >
            <Sparkles size={11} />
            MODE: LLM
          </span>
        );
      case 'fallback':
        return (
          <span
            className="rt-badge rt-badge-amber"
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
            }}
          >
            <Cpu size={11} />
            MODE: FALLBACK
          </span>
        );
      case 'running':
        return (
          <span
            className="rt-badge rt-badge-cyan"
            style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              letterSpacing: '0.04em',
            }}
          >
            <RotateCcw size={11} className="spin" />
            MODE: RUNNING
          </span>
        );
      case 'pending':
      default:
        return (
          <span
            className="rt-badge rt-badge-gray"
            style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              letterSpacing: '0.04em',
            }}
          >
            <Bot size={11} />
            MODE: READY
          </span>
        );
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Stream Replay and One-Click Demo Reset Bar */}
      <DemoControls
        onResetComplete={() => {
          setSteps([]);
          setAssessment(null);
          setProposedAction(null);
          setCaseStatus('open');
          setMode('pending');
          setRefreshTrigger((prev) => prev + 1);
        }}
      />

      {/* Control Header & Live Case Picker */}
      <div
        className="rt-card"
        style={{
          padding: '1rem 1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          borderLeft: '4px solid var(--brand-mint)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '8px',
              backgroundColor: 'var(--brand-mint-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--brand-forest)',
            }}
          >
            <FileSearch size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Autonomous Investigation Agent
              </h2>
              {/* Dynamic Header Badge per Requirements */}
              {renderModeBadge()}
            </div>
            <div style={{ fontSize: '0.775rem', color: 'var(--text-secondary)' }}>
              8-Tool Restricted Graph Engine with Real-Time SSE Stream & Anti-Hallucination Guardrails
              {investigationId && (
                <span style={{ marginLeft: '0.5rem', color: 'var(--accent-blue)' }}>
                  • Active Run: <span className="mono">{investigationId}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Case Selector and Trigger Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <select
            value={selectedCaseId}
            onChange={(e) => {
              setSelectedCaseId(e.target.value);
              setCustomCaseId('');
            }}
            disabled={isRunning || loadingCases}
            style={{
              backgroundColor: 'var(--surface-primary)',
              border: '1px solid var(--border-medium)',
              borderRadius: '6px',
              padding: '0.45rem 0.75rem',
              color: 'var(--text-primary)',
              fontSize: '0.8rem',
              maxWidth: '340px',
            }}
          >
            {loadingCases ? (
              <option value="">Loading live cases...</option>
            ) : cases.length === 0 ? (
              <option value="">No cases detected (enter Custom ID)</option>
            ) : (
              cases.map((c) => (
                <option key={c.case_id} value={c.case_id}>
                  {c.case_id} — Score: {c.score} ({c.patterns.join(', ')})
                </option>
              ))
            )}
          </select>

          {/* Custom Case ID Manual Entry Fallback */}
          <input
            type="text"
            placeholder="Custom Case ID"
            value={customCaseId}
            onChange={(e) => setCustomCaseId(e.target.value.toUpperCase())}
            disabled={isRunning}
            style={{
              backgroundColor: 'var(--surface-primary)',
              border: '1px solid var(--border-medium)',
              borderRadius: '6px',
              padding: '0.45rem 0.65rem',
              color: 'var(--text-primary)',
              fontSize: '0.8rem',
              width: '140px',
            }}
          />

          <button
            onClick={startInvestigation}
            disabled={isRunning || !activeCaseId}
            className="rt-button rt-button-primary"
            style={{ fontWeight: 600 }}
          >
            {isRunning ? (
              <>
                <RotateCcw size={14} className="spin" />
                <span>Investigating...</span>
              </>
            ) : (
              <>
                <Play size={14} />
                <span>Run Investigation</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Grid: Live Agent Feed & Memory Precedents */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(320px, 1fr)', gap: '1.25rem', alignItems: 'start' }}>
        {/* Left Column: Real-Time SSE Step Stream & Final Narrative */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Tool Execution Logs Stream */}
          <div className="rt-card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <Terminal size={17} color="var(--brand-teal)" />
                <h3 style={{ fontSize: '0.925rem', fontWeight: 600 }}>Agent Execution Trace (Live SSE Feed)</h3>
              </div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                {isRunning ? (
                  <span style={{ color: 'var(--brand-teal)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: 'var(--brand-mint)', display: 'inline-block' }} />
                    Streaming tool calls...
                  </span>
                ) : (
                  <span>{steps.length} tool calls executed</span>
                )}
              </div>
            </div>

            {/* Steps Container */}
            <div
              style={{
                backgroundColor: 'var(--surface-muted)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '0.85rem',
                maxHeight: '340px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {steps.length === 0 && !isRunning && (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  Click "Run Investigation" to initiate the agent loop and stream real-time tool calls.
                </div>
              )}

              {steps.length === 0 && isRunning && (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--brand-teal)', fontSize: '0.8rem' }}>
                  <RotateCcw size={16} className="spin" style={{ margin: '0 auto 0.5rem' }} />
                  Connecting to SSE stream & launching initial tool call...
                </div>
              )}

              {steps.map((st, idx) => {
                const isExpanded = !!expandedSteps[idx];
                const toolName = st.tool || 'unknown_tool';
                const hasEvidence = st.evidence && ((st.evidence.account_ids && st.evidence.account_ids.length > 0) || (st.evidence.tx_ids && st.evidence.tx_ids.length > 0));

                return (
                  <div
                    key={idx}
                    style={{
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      backgroundColor: 'var(--surface-primary)',
                      padding: '0.65rem 0.85rem',
                      fontSize: '0.775rem',
                    }}
                  >
                    <div
                      onClick={() => toggleStepExpand(idx)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        gap: '0.5rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                        {isExpanded ? <ChevronDown size={14} color="var(--text-muted)" /> : <ChevronRight size={14} color="var(--text-muted)" />}
                        <span style={{ color: 'var(--brand-teal)', fontWeight: 600 }}>
                          [{st.step || st.index || idx + 1}]
                        </span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                          {toolName}()
                        </span>
                      </div>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                        {hasEvidence ? 'Evidence attached' : 'Query result'}
                      </span>
                    </div>

                    {/* Summary text */}
                    <div style={{ marginTop: '0.35rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                      {st.summary}
                    </div>

                    {/* Evidence Chips */}
                    {hasEvidence && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.45rem' }}>
                        {st.evidence?.account_ids?.map((acc) => (
                          <button
                            key={acc}
                            onClick={() => onInspectAccount(acc)}
                            className="rt-badge badge-personal mono"
                            style={{ fontSize: '0.675rem', cursor: 'pointer' }}
                            title="Inspect account in graph"
                          >
                            {acc}
                          </button>
                        ))}
                        {st.evidence?.tx_ids?.map((tx) => (
                          <span key={tx} className="rt-badge badge-merchant mono" style={{ fontSize: '0.675rem' }}>
                            {tx}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Collapsible raw arguments view */}
                    {isExpanded && st.args && (
                      <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                          Parameters passed:
                        </div>
                        <pre style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: 0, overflowX: 'auto', backgroundColor: 'var(--surface-secondary)', padding: '0.4rem', borderRadius: '4px' }}>
                          {JSON.stringify(st.args, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={stepsEndRef} />
            </div>

            {streamError && (
              <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.85rem', backgroundColor: 'var(--accent-red-subtle)', borderRadius: '6px', color: 'var(--accent-red)', fontSize: '0.775rem', border: '1px solid var(--accent-red-border)' }}>
                <AlertCircle size={14} style={{ display: 'inline', marginRight: '0.4rem', verticalAlign: 'text-bottom' }} />
                {streamError}
              </div>
            )}
          </div>

          {/* Final Narrative & Findings Card (When Assessment is Available) */}
          {assessment && (
            <div
              className="rt-card"
              style={{
                padding: '1.25rem',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <div style={{ padding: '0.35rem', borderRadius: '6px', backgroundColor: 'var(--brand-mint-subtle)', color: 'var(--brand-forest)' }}>
                    <FileText size={18} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Investigation Assessment & Narrative
                    </h3>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Anti-hallucination verified summary with cited graph evidence
                    </div>
                  </div>
                </div>
                {renderRiskBadge(assessment.risk_level)}
              </div>

              {/* Formatted Executive Narrative using MarkdownViewer */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.45rem' }}>
                  Executive Narrative
                </div>
                <div
                  style={{
                    backgroundColor: 'var(--surface-secondary)',
                    padding: '1rem 1.25rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <MarkdownViewer
                    content={assessment.narrative || assessment.summary || ''}
                    onInspectAccount={onInspectAccount}
                  />
                </div>
              </div>

              {/* Verified Findings with Evidence Chips */}
              {assessment.findings && assessment.findings.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>
                    Corroborated Findings ({assessment.findings.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {assessment.findings.map((f, i) => (
                      <div
                        key={i}
                        style={{
                          padding: '0.65rem 0.85rem',
                          backgroundColor: 'var(--surface-secondary)',
                          borderRadius: '6px',
                          border: '1px solid var(--border-subtle)',
                          fontSize: '0.8rem',
                        }}
                      >
                        <div style={{ color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                          • {f.text}
                        </div>
                        {f.evidence_ids && f.evidence_ids.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>Evidence:</span>
                            {f.evidence_ids.map((id) => (
                              <button
                                key={id}
                                onClick={() => id.startsWith('ACC_') && onInspectAccount(id)}
                                className={`rt-badge ${id.startsWith('ACC_') ? 'badge-personal' : 'badge-merchant'} mono`}
                                style={{ fontSize: '0.675rem', cursor: id.startsWith('ACC_') ? 'pointer' : 'default' }}
                              >
                                {id}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Decision Bar: Human In The Loop Action Panel */}
          <DecisionBar
            caseId={activeCaseId}
            currentStatus={caseStatus}
            proposedAction={proposedAction}
            onDecisionRecorded={handleDecisionRecorded}
          />
        </div>

        {/* Right Column: FalkorDB Memory Graph Precedents */}
        <div>
          <MemoryPanel
            caseId={activeCaseId}
            onSelectCase={(cId) => {
              setSelectedCaseId(cId);
              setCustomCaseId('');
            }}
            refreshTrigger={refreshTrigger}
          />
        </div>
      </div>
    </div>
  );
};

export default InvestigationPanel;

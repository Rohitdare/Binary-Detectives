import React, { useEffect, useState, useRef } from 'react';
import {
  FileSearch,
  Sparkles,
  Cpu,
  RotateCcw,
  Play,
  Terminal,
  FileText,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Clock,
  Bot,
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
  ProposedAction,
} from '../../types';

export interface InvestigationPanelProps {
  initialCaseId?: string;
  onInspectAccount?: (accountId: string) => void;
  onHighlight?: (evidence: { account_ids: string[]; tx_ids: string[] }) => void;
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
  onHighlight = () => {},
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

  // Trigger MemoryPanel re-fetch when new decisions or cases are processed
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [similarCaseCount, setSimilarCaseCount] = useState<number | null>(null);

  // Expanded steps for inspecting raw tool arguments
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});

  const eventSourceRef = useRef<EventSource | null>(null);
  const stepsEndRef = useRef<HTMLDivElement | null>(null);

  const activeCaseId = customCaseId.trim() || selectedCaseId;
  const activeCase = cases.find((c) => c.case_id === activeCaseId);

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

  // Fetch case status & decisions for activeCaseId on mount and when changed
  useEffect(() => {
    let isMounted = true;
    if (!activeCaseId) return;

    ringtraceApi
      .getCase(activeCaseId)
      .then((c) => {
        if (isMounted && c && c.status) {
          setCaseStatus(c.status);
        }
      })
      .catch(() => {});

    ringtraceApi
      .getCaseDecisions(activeCaseId)
      .then((dRes) => {
        if (isMounted && dRes.items && dRes.items.length > 0) {
          const latest = dRes.items[0];
          const statusMap: Record<string, string> = {
            escalate: 'escalated',
            monitor: 'monitoring',
            dismiss: 'dismissed',
            draft_sar: 'sar_drafted',
          };
          setCaseStatus(statusMap[latest.decision] || latest.decision);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [activeCaseId, refreshTrigger]);

  // Sync initialCaseId when changed by parent queue selection
  useEffect(() => {
    if (initialCaseId) {
      setSelectedCaseId(initialCaseId);
      setCustomCaseId('');
    }
  }, [initialCaseId]);

  // Auto-scroll tool steps container on new SSE events
  useEffect(() => {
    if (isRunning && stepsEndRef.current) {
      stepsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [steps, isRunning]);

  // Clean up SSE connection on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const toggleStepExpand = (index: number) => {
    setExpandedSteps((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const handleStepClick = (idx: number, st: InvestigationStep) => {
    toggleStepExpand(idx);
    if (onHighlight && st.evidence) {
      onHighlight({
        account_ids: st.evidence.account_ids || [],
        tx_ids: st.evidence.tx_ids || [],
      });
    }
  };

  const startInvestigation = async () => {
    if (!activeCaseId || isRunning) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
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

      es.addEventListener('heartbeat', () => {
        // SSE Heartbeat received from backend every 15s to keep connection alive
      });

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
        // Handle transient reconnect or fallback
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
      setRefreshTrigger((prev) => prev + 1);
    } else {
      if (proposedAction) {
        setProposedAction((prev) => (prev ? { ...prev, status: 'rejected' } : null));
      }
      setRefreshTrigger((prev) => prev + 1);
    }
  };

  const renderRiskBadge = (risk?: string) => {
    const level = (risk || '').toLowerCase();
    if (level === 'high') {
      return (
        <span
          className="rt-badge rt-badge-rose"
          style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
        >
          <ShieldAlert size={13} />
          HIGH RISK
        </span>
      );
    }
    if (level === 'medium') {
      return (
        <span
          className="rt-badge rt-badge-amber"
          style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
        >
          <Clock size={13} />
          MEDIUM RISK
        </span>
      );
    }
    return (
      <span
        className="rt-badge rt-badge-emerald"
        style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
      >
        <Bot size={13} />
        LOW RISK
      </span>
    );
  };

  const renderModeBadge = () => {
    switch (mode) {
      case 'llm':
        return (
          <span
            className="rt-badge rt-badge-purple"
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
          padding: '1.25rem 1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          backgroundColor: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderLeft: '4px solid #7C3AED',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '8px',
              backgroundColor: '#F5F3FF',
              border: '1px solid #DDD6FE',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#7C3AED',
            }}
          >
            <FileSearch size={20} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
                Autonomous Investigation Agent
              </h2>
              {renderModeBadge()}
            </div>
            <div style={{ fontSize: '0.775rem', color: '#64748B', marginTop: '0.2rem' }}>
              8-Tool Restricted Graph Engine with Real-Time SSE Stream & Anti-Hallucination Guardrails
              {investigationId && (
                <span style={{ marginLeft: '0.5rem', color: '#7C3AED', fontWeight: 600 }}>
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
              backgroundColor: '#FFFFFF',
              border: '1px solid #CBD5E1',
              borderRadius: '6px',
              padding: '0.45rem 0.75rem',
              color: '#0F172A',
              fontSize: '0.8rem',
              fontWeight: 500,
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
              backgroundColor: '#FFFFFF',
              border: '1px solid #CBD5E1',
              borderRadius: '6px',
              padding: '0.45rem 0.65rem',
              color: '#0F172A',
              fontSize: '0.8rem',
              width: '140px',
              fontWeight: 500,
              fontFamily: 'var(--font-mono)',
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

      {/* Case Summary Bar displaying metrics and similar-case count */}
      {activeCaseId && (
        <div
          className="rt-card"
          style={{
            padding: '0.75rem 1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.85rem',
            backgroundColor: '#F8FAFC',
            border: '1px solid #E2E8F0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
            <div>
              <span style={{ color: '#64748B' }}>Case:</span>{' '}
              <strong className="mono" style={{ color: '#7C3AED' }}>{activeCaseId}</strong>
            </div>
            {activeCase && (
              <>
                <div>
                  <span style={{ color: '#64748B' }}>Triage Score:</span>{' '}
                  <strong style={{ color: '#0F172A' }}>{activeCase.score} / 100</strong>{' '}
                  <span
                    className={`rt-badge ${activeCase.severity === 'high' ? 'rt-badge-rose' : activeCase.severity === 'medium' ? 'rt-badge-amber' : 'rt-badge-gray'}`}
                    style={{ textTransform: 'uppercase', fontSize: '0.65rem' }}
                  >
                    {activeCase.severity}
                  </span>
                </div>
                <div>
                  <span style={{ color: '#64748B' }}>Typology:</span>{' '}
                  {activeCase.patterns.map((p) => (
                    <span key={p} className="rt-badge rt-badge-emerald" style={{ marginLeft: '4px', fontSize: '0.65rem' }}>
                      {p.replace('_', '-')}
                    </span>
                  ))}
                </div>
                <div>
                  <span style={{ color: '#64748B' }}>Scope:</span>{' '}
                  <span style={{ color: '#0F172A' }}>{activeCase.account_count} accounts · {activeCase.tx_count} txs</span>
                </div>
              </>
            )}
            {/* Similar-case count per prompt requirement */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ color: '#64748B' }}>Similar Cases:</span>{' '}
              <span
                className="rt-badge rt-badge-purple mono"
                style={{ fontWeight: 700, fontSize: '0.725rem' }}
              >
                {similarCaseCount !== null
                  ? `${similarCaseCount} ${similarCaseCount === 1 ? 'precedent' : 'precedents'} in memory`
                  : 'Querying memory...'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.775rem' }}>
            <span style={{ color: '#64748B' }}>Status:</span>
            <span className="rt-badge rt-badge-gray" style={{ textTransform: 'capitalize' }}>
              {caseStatus}
            </span>
          </div>
        </div>
      )}

      {/* Main Grid: Live Agent Feed & Memory Precedents */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.6fr) minmax(320px, 1fr)',
          gap: '1.25rem',
          alignItems: 'start',
        }}
      >
        {/* Left Column: Real-Time SSE Step Stream & Final Narrative */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Tool Execution Logs Stream */}
          <div
            className="rt-card"
            style={{
              padding: '1.25rem',
              backgroundColor: '#FFFFFF',
              border: '1px solid #E2E8F0',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '0.85rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <Terminal size={17} color="#7C3AED" />
                <h3 style={{ fontSize: '0.925rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
                  Agent Execution Trace (Live SSE Feed)
                </h3>
              </div>
              {/* Tool calls counter climbs live as steps arrive */}
              <div
                style={{
                  fontSize: '0.725rem',
                  color: '#64748B',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <span style={{ fontWeight: 600, color: isRunning ? '#7C3AED' : '#0F172A' }}>
                  {steps.length} tool calls executed
                </span>
                {isRunning && (
                  <span
                    style={{
                      color: '#7C3AED',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      fontWeight: 600,
                    }}
                  >
                    <span
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        backgroundColor: '#7C3AED',
                        display: 'inline-block',
                      }}
                      className="pulse-indicator"
                    />
                    Streaming
                  </span>
                )}
              </div>
            </div>

            {/* Steps Container */}
            <div
              style={{
                backgroundColor: '#F8FAFC',
                border: '1px solid #E2E8F0',
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
                <div
                  style={{
                    textAlign: 'center',
                    padding: '2.5rem 1rem',
                    color: '#64748B',
                    fontSize: '0.825rem',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  Click "Run Investigation" to initiate the agent loop and stream real-time tool calls.
                </div>
              )}

              {steps.length === 0 && isRunning && (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '2.5rem 1rem',
                    color: '#7C3AED',
                    fontSize: '0.825rem',
                    fontFamily: 'var(--font-sans)',
                    fontWeight: 500,
                  }}
                >
                  <RotateCcw size={16} className="spin" style={{ margin: '0 auto 0.5rem' }} />
                  Connecting to SSE stream & launching initial tool call...
                </div>
              )}

              {steps.map((st, idx) => {
                const isExpanded = !!expandedSteps[idx];
                const toolName = st.tool || 'unknown_tool';
                const hasEvidence =
                  st.evidence &&
                  ((st.evidence.account_ids && st.evidence.account_ids.length > 0) ||
                    (st.evidence.tx_ids && st.evidence.tx_ids.length > 0));

                return (
                  <div
                    key={idx}
                    style={{
                      border: '1px solid #E2E8F0',
                      borderRadius: '6px',
                      backgroundColor: '#FFFFFF',
                      padding: '0.65rem 0.85rem',
                      fontSize: '0.775rem',
                      boxShadow: '0 1px 2px rgba(15, 23, 42, 0.02)',
                    }}
                  >
                    <div
                      onClick={() => handleStepClick(idx, st)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        gap: '0.5rem',
                      }}
                      title="Click step to expand details and highlight graph evidence"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                        {isExpanded ? (
                          <ChevronDown size={14} color="#64748B" />
                        ) : (
                          <ChevronRight size={14} color="#64748B" />
                        )}
                        <span style={{ color: '#7C3AED', fontWeight: 700 }}>
                          [{st.step || st.index || idx + 1}]
                        </span>
                        <span style={{ color: '#0F172A', fontWeight: 700 }}>{toolName}()</span>
                      </div>
                      <span style={{ color: '#64748B', fontSize: '0.7rem' }}>
                        {hasEvidence ? 'Evidence attached' : 'Query result'}
                      </span>
                    </div>

                    {/* Summary text */}
                    <div
                      style={{
                        marginTop: '0.35rem',
                        color: '#334155',
                        fontFamily: 'var(--font-sans)',
                        fontSize: '0.8rem',
                        lineHeight: 1.5,
                      }}
                    >
                      {st.summary}
                    </div>

                    {/* Evidence Chips */}
                    {hasEvidence && (
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.35rem',
                          marginTop: '0.45rem',
                        }}
                      >
                        {st.evidence?.account_ids?.map((acc) => (
                          <button
                            key={acc}
                            onClick={(e) => {
                              e.stopPropagation();
                              onInspectAccount(acc);
                            }}
                            className="rt-badge rt-badge-gray mono"
                            style={{ fontSize: '0.675rem', cursor: 'pointer' }}
                            title="Inspect account in graph"
                          >
                            {acc}
                          </button>
                        ))}
                        {st.evidence?.tx_ids?.map((tx) => (
                          <span
                            key={tx}
                            className="rt-badge rt-badge-cyan mono"
                            style={{ fontSize: '0.675rem' }}
                          >
                            {tx}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Collapsible raw arguments view */}
                    {isExpanded && st.args && (
                      <div
                        style={{
                          marginTop: '0.5rem',
                          paddingTop: '0.5rem',
                          borderTop: '1px solid #E2E8F0',
                        }}
                      >
                        <div style={{ fontSize: '0.7rem', color: '#64748B', marginBottom: '0.2rem' }}>
                          Parameters passed:
                        </div>
                        <pre
                          style={{
                            fontSize: '0.7rem',
                            color: '#0F172A',
                            margin: 0,
                            overflowX: 'auto',
                            backgroundColor: '#F8FAFC',
                            padding: '0.4rem',
                            borderRadius: '4px',
                          }}
                        >
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
              <div
                style={{
                  marginTop: '0.75rem',
                  padding: '0.6rem 0.85rem',
                  backgroundColor: '#FEF2F2',
                  border: '1px solid #FCA5A5',
                  borderRadius: '6px',
                  color: '#B91C1C',
                  fontSize: '0.775rem',
                }}
              >
                <AlertCircle
                  size={14}
                  style={{ display: 'inline', marginRight: '0.4rem', verticalAlign: 'text-bottom' }}
                />
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
                border: '1px solid #DDD6FE',
                backgroundColor: '#FFFFFF',
                boxShadow: '0 4px 16px rgba(124, 58, 237, 0.05)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '1rem',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <div
                    style={{
                      padding: '0.4rem',
                      borderRadius: '6px',
                      backgroundColor: '#F5F3FF',
                      color: '#7C3AED',
                    }}
                  >
                    <FileText size={18} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
                      Investigation Assessment & Narrative
                    </h3>
                    <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
                      Anti-hallucination verified summary with cited graph evidence
                    </div>
                  </div>
                </div>
                {renderRiskBadge(assessment.risk_level)}
              </div>

              {/* Formatted Executive Narrative using MarkdownViewer */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div
                  style={{
                    fontSize: '0.725rem',
                    fontWeight: 700,
                    color: '#64748B',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: '0.45rem',
                  }}
                >
                  Executive Narrative
                </div>
                <div
                  style={{
                    backgroundColor: '#F8FAFC',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    lineHeight: 1.6,
                    color: '#0F172A',
                    border: '1px solid #E2E8F0',
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
                  <div
                    style={{
                      fontSize: '0.725rem',
                      fontWeight: 700,
                      color: '#64748B',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: '0.5rem',
                    }}
                  >
                    Corroborated Findings ({assessment.findings.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {assessment.findings.map((f, i) => (
                      <div
                        key={i}
                        style={{
                          padding: '0.65rem 0.85rem',
                          backgroundColor: '#FFFFFF',
                          borderRadius: '6px',
                          border: '1px solid #E2E8F0',
                          fontSize: '0.8rem',
                        }}
                      >
                        <div style={{ color: '#0F172A', fontWeight: 500, marginBottom: '0.35rem' }}>
                          • {f.text}
                        </div>
                        {f.evidence_ids && f.evidence_ids.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.675rem', color: '#64748B' }}>Evidence:</span>
                            {f.evidence_ids.map((id) => (
                              <button
                                key={id}
                                onClick={() => id.startsWith('ACC_') && onInspectAccount(id)}
                                className={`rt-badge ${id.startsWith('ACC_') ? 'rt-badge-gray' : 'rt-badge-cyan'} mono`}
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
            onSimilarCasesLoaded={(items) => setSimilarCaseCount(items.length)}
            refreshTrigger={refreshTrigger}
          />
        </div>
      </div>
    </div>
  );
};

export default InvestigationPanel;

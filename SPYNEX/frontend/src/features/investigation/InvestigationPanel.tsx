import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Sparkles,
  Cpu,
  RotateCcw,
  Play,
  Terminal,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Clock,
  Bot,
  ShieldCheck,
} from 'lucide-react';
import { ringtraceApi } from '../../services/api';
import { DecisionBar } from './DecisionBar';
import { MemoryPanel } from './MemoryPanel';
import { DemoControls } from './DemoControls';
import { MarkdownViewer } from './MarkdownViewer';
import { InvestigationTools } from './InvestigationTools';
import type {
  CaseRecord,
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
 * Autonomous Investigation Agent Workspace.
 * Re-architected to emphasize evidence, executive narrative, and decision authority
 * with clean information hierarchy, zero nested cards, and calibrated risk colors.
 */
export const InvestigationPanel: React.FC<InvestigationPanelProps> = ({
  initialCaseId = 'CASE_0001',
  onInspectAccount = () => {},
  onHighlight = () => {},
}) => {
  const [selectedCaseId, setSelectedCaseId] = useState(initialCaseId);

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

  // Expanded tool parameters inside audit trail
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
  // Collapsible audit trace accordion (collapsed by default when assessment is ready)
  const [isTraceExpanded, setIsTraceExpanded] = useState<boolean>(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const stepsEndRef = useRef<HTMLDivElement | null>(null);

  const activeCaseId = selectedCaseId;
  const activeCase = cases.find((c) => c.case_id === activeCaseId);

  // Unified cases list ensuring initialCaseId or selectedCaseId is always present in dropdown
  const displayCases = useMemo(() => {
    const list = [...cases];
    const candidateId = selectedCaseId || initialCaseId;
    if (candidateId && !list.some((c) => c.case_id === candidateId)) {
      list.unshift({
        case_id: candidateId,
        score: 75,
        severity: 'medium',
        patterns: ['flagged'],
        account_count: 0,
        tx_count: 0,
        total_amount: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'open',
      } as unknown as CaseRecord);
    }
    return list;
  }, [cases, selectedCaseId, initialCaseId]);

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
    setIsTraceExpanded(true); // show live execution trace while active

    try {
      // 1. Trigger agent loop via POST /api/v1/cases/{id}/investigations
      const startRes = await ringtraceApi.startInvestigation(activeCaseId);
      const invId = startRes.investigation_id;

      // 2. Open real-time Server-Sent Events feed
      const sseUrl = `/api/v1/investigations/${encodeURIComponent(invId)}/events`;
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.addEventListener('heartbeat', () => {});

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
          setMode(doneData.mode === 'llm' ? 'llm' : 'fallback');
          if (doneData.assessment) setAssessment(doneData.assessment);
          if (doneData.proposed_action) setProposedAction(doneData.proposed_action);
          setIsRunning(false);
          setIsTraceExpanded(false); // collapse trace once complete so assessment is first
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
          setStreamError('Connection to agent event stream interrupted');
        }
        setIsRunning(false);
        es.close();
      });
    } catch (err: any) {
      setIsRunning(false);
      setStreamError(err?.message || 'Failed to trigger agent investigation loop');
      setMode('fallback');
    }
  };

  const handleDecisionRecorded = (decisionRes: any) => {
    if (decisionRes && decisionRes.decision) {
      const statusMap: Record<string, string> = {
        escalate: 'escalated',
        monitor: 'monitoring',
        dismiss: 'dismissed',
        draft_sar: 'sar_drafted',
      };
      setCaseStatus(statusMap[decisionRes.decision] || decisionRes.decision);
    }
    setRefreshTrigger((prev) => prev + 1);
  };

  const renderRiskBadge = (riskLevel?: string) => {
    const level = (riskLevel || '').toLowerCase();
    if (level === 'high') {
      return (
        <span className="rt-badge rt-badge-rose" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}>
          <ShieldAlert size={13} />
          HIGH RISK
        </span>
      );
    }
    if (level === 'medium') {
      return (
        <span className="rt-badge rt-badge-amber" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}>
          <Clock size={13} />
          MEDIUM RISK
        </span>
      );
    }
    return (
      <span className="rt-badge rt-badge-emerald" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}>
        <ShieldCheck size={13} />
        LOW RISK
      </span>
    );
  };

  const renderModeBadge = () => {
    switch (mode) {
      case 'llm':
        return (
          <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.7rem', fontWeight: 600 }}>
            <Sparkles size={11} />
            AI REASONING ACTIVE
          </span>
        );
      case 'fallback':
        return (
          <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.7rem', fontWeight: 600 }}>
            <Cpu size={11} />
            RULE-BASED VERIFICATION
          </span>
        );
      case 'running':
        return (
          <span className="rt-badge rt-badge-amber" style={{ fontSize: '0.7rem', fontWeight: 600 }}>
            <RotateCcw size={11} className="spin" />
            INVESTIGATING
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.7rem', fontWeight: 600 }}>
            <Bot size={11} />
            READY FOR AUDIT
          </span>
        );
    }
  };

  const formatToolName = (name: string): string => {
    const map: Record<string, string> = {
      inspect_account_subgraph: 'Account Neighborhood & Subgraph Inspection',
      query_temporal_transfers: 'Temporal Velocity & Transfer Analysis',
      trace_upstream_source: 'Upstream Inflow & Source Tracing',
      trace_downstream_sink: 'Downstream Outflow & Destination Tracing',
      evaluate_risk_heuristic: 'Typology Risk & Centrality Heuristic',
      query_similar_precedents: 'Historical Precedent Memory Search',
      retrieve_fiu_typology_rules: 'Regulatory Compliance Rules Lookup',
      verify_evidence_integrity: 'Evidence Verification & Integrity Audit',
    };
    return map[name] || name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const renderStepParameters = (args: any) => {
    if (!args || typeof args !== 'object') return null;
    const entries = Object.entries(args);
    if (entries.length === 0) return null;
    return (
      <div style={{ marginTop: '0.5rem', paddingTop: '0.45rem', borderTop: '1px solid #F1F5F9' }}>
        <span style={{ fontSize: '0.675rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          Query Parameters:
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.25rem' }}>
          {entries.map(([k, v]) => (
            <div
              key={k}
              style={{
                fontSize: '0.725rem',
                padding: '0.2rem 0.5rem',
                backgroundColor: '#F8FAFC',
                borderRadius: '4px',
                border: '1px solid #E2E8F0',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
              }}
            >
              <span style={{ color: '#64748B', fontWeight: 500 }}>{k.replace(/_/g, ' ')}:</span>
              <span className="mono" style={{ color: '#0F172A', fontWeight: 600 }}>
                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
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
          border: '1px solid #E7EAF1',
          borderLeft: '4px solid var(--brand-purple)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: '#F3F0FF',
              border: '1px solid #E5DDFB',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6D4AFF',
            }}
          >
            <Bot size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <h2
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 750,
                  color: 'var(--text-primary)',
                  margin: 0,
                  fontFamily: 'var(--font-display)',
                  letterSpacing: '-0.02em',
                }}
              >
                Investigation Agent
              </h2>
              {renderModeBadge()}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              Investigate suspicious activity, follow evidence, and review proposed actions.
            </div>
          </div>
        </div>

        {/* Case selector dropdown and Run Investigation CTA */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.775rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Case ID:
          </label>
          <select
            value={selectedCaseId}
            onChange={(e) => {
              setSelectedCaseId(e.target.value);
            }}
            disabled={isRunning || loadingCases}
            style={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #CBD5E1',
              borderRadius: '6px',
              padding: '0.45rem 0.75rem',
              color: '#0F172A',
              fontSize: '0.8rem',
              fontWeight: 600,
              minWidth: '260px',
              cursor: isRunning ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {loadingCases && displayCases.length === 0 ? (
              <option>Loading cases...</option>
            ) : displayCases.length === 0 ? (
              <option>No cases in database</option>
            ) : (
              displayCases.map((c) => (
                <option key={c.case_id} value={c.case_id}>
                  {c.case_id} — Score {c.score} ({c.patterns.join(', ')})
                </option>
              ))
            )}
          </select>

          <button
            type="button"
            onClick={startInvestigation}
            disabled={isRunning || !activeCaseId}
            className="rt-button rt-button-primary"
            style={{
              fontWeight: 600,
              backgroundColor: '#0F172A',
              color: '#FFFFFF',
              borderColor: '#0F172A',
            }}
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

      {/* Case Summary Bar */}
      {activeCaseId && (
        <div
          className="rt-card"
          style={{
            padding: '0.75rem 1.25rem',
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
              <span style={{ color: '#64748B' }}>Target:</span>{' '}
              <strong className="mono" style={{ color: '#0F172A' }}>{activeCaseId}</strong>
            </div>
            {activeCase && (
              <>
                <div>
                  <span style={{ color: '#64748B' }}>Triage Score:</span>{' '}
                  <strong style={{ color: '#0F172A' }}>{activeCase.score} / 100</strong>{' '}
                  <span
                    className={`rt-badge ${
                      activeCase.severity === 'high'
                        ? 'rt-badge-rose'
                        : activeCase.severity === 'medium'
                        ? 'rt-badge-amber'
                        : 'rt-badge-gray'
                    }`}
                    style={{ textTransform: 'uppercase', fontSize: '0.65rem' }}
                  >
                    {activeCase.severity}
                  </span>
                </div>
                <div>
                  <span style={{ color: '#64748B' }}>Typology:</span>{' '}
                  {activeCase.patterns.map((p) => (
                    <span key={p} className="rt-badge rt-badge-gray" style={{ marginLeft: '4px', fontSize: '0.65rem' }}>
                      {p.replace('_', '-')}
                    </span>
                  ))}
                </div>
                <div>
                  <span style={{ color: '#64748B' }}>Scope:</span>{' '}
                  <span style={{ color: '#0F172A', fontWeight: 600 }}>
                    {activeCase.account_count} accounts · {activeCase.tx_count} transfers
                  </span>
                </div>
              </>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ color: '#64748B' }}>Memory Precedents:</span>{' '}
              <span className="rt-badge rt-badge-gray mono" style={{ fontWeight: 600, fontSize: '0.7rem' }}>
                {similarCaseCount !== null
                  ? `${similarCaseCount} ${similarCaseCount === 1 ? 'case' : 'cases'} in memory`
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

      {/* Main Column: Full-Width Dossier, Trace, and Bottom Memory Panel */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* 1. INVESTIGATION DOSSIER & ASSESSMENT (Rendered First for Clear Information Hierarchy) */}
          {assessment ? (
            <div
              className="rt-card"
              style={{
                padding: '1.5rem',
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              {/* Dossier Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '1.25rem',
                  paddingBottom: '1rem',
                  borderBottom: '1px solid #F1F5F9',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <h3
                      style={{
                        fontSize: '1.15rem',
                        fontWeight: 700,
                        color: '#0F172A',
                        margin: 0,
                        fontFamily: 'var(--font-display)',
                      }}
                    >
                      Investigation Report & Assessment
                    </h3>
                    {renderRiskBadge(assessment.risk_level)}
                  </div>
                  <div style={{ fontSize: '0.775rem', color: '#64748B', marginTop: '0.2rem' }}>
                    Verified forensic graph analysis for case <span className="mono" style={{ color: '#0F172A', fontWeight: 600 }}>{activeCaseId}</span>
                  </div>
                </div>
              </div>

              {/* Executive Narrative - Clean reading layout without nested grey border boxes! */}
              <div style={{ marginBottom: '1.5rem' }}>
                <MarkdownViewer
                  content={assessment.narrative || assessment.summary || ''}
                  onInspectAccount={onInspectAccount}
                />
              </div>

              {/* Corroborated Findings - Clean semantic list with subtle hairline divider */}
              {assessment.findings && assessment.findings.length > 0 && (
                <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid #F1F5F9' }}>
                  <div
                    style={{
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      color: '#0F172A',
                      fontFamily: 'var(--font-display)',
                      marginBottom: '0.75rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <span>Corroborated Graph Evidence</span>
                    <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.675rem' }}>
                      {assessment.findings.length} findings
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {assessment.findings.map((f, i) => (
                      <div
                        key={i}
                        style={{
                          paddingLeft: '0.85rem',
                          borderLeft: '2px solid #CBD5E1',
                          fontSize: '0.825rem',
                          lineHeight: 1.55,
                        }}
                      >
                        <div style={{ color: '#1E293B', fontWeight: 500, marginBottom: '0.25rem' }}>
                          <MarkdownViewer content={f.text} inlineOnly />
                        </div>
                        {f.evidence_ids && f.evidence_ids.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center', marginTop: '0.25rem' }}>
                            <span style={{ fontSize: '0.675rem', color: '#64748B' }}>Evidence:</span>
                            {f.evidence_ids.map((id) => (
                              <button
                                key={id}
                                type="button"
                                onClick={() => id.startsWith('ACC_') && onInspectAccount(id)}
                                className="rt-badge rt-badge-gray mono"
                                style={{ fontSize: '0.7rem', cursor: id.startsWith('ACC_') ? 'pointer' : 'default' }}
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

              {/* Integrated Human-in-the-Loop Decision Section (No box-in-box) */}
              <DecisionBar
                caseId={activeCaseId}
                currentStatus={caseStatus}
                embedded={true}
                proposedAction={proposedAction}
                onDecisionRecorded={handleDecisionRecorded}
              />
            </div>
          ) : !isRunning ? (
            /* Clean Empty State when investigation hasn't been run yet */
            <div
              className="rt-card"
              style={{
                padding: '2.5rem 1.5rem',
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
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
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  backgroundColor: '#F1F5F9',
                  border: '1px solid #E2E8F0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#0F172A',
                }}
              >
                <Bot size={22} />
              </div>
              <button
                type="button"
                onClick={startInvestigation}
                disabled={isRunning || !activeCaseId}
                className="rt-button rt-button-primary rt-button-sm"
                style={{
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  backgroundColor: '#0F172A',
                  color: '#FFFFFF',
                  borderColor: '#0F172A',
                  padding: '0.45rem 0.95rem',
                  borderRadius: '6px',
                }}
              >
                <Play size={13} />
                <span>Launch Investigation</span>
              </button>
            </div>
          ) : null}

          {/* 2. AGENT EXECUTION TRACE (Live Streaming or Collapsible Audit Trail) */}
          {(isRunning || steps.length > 0) && (
            <div
              className="rt-card"
              style={{
                padding: '1.25rem',
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
              }}
            >
              <div
                onClick={() => !isRunning && setIsTraceExpanded((prev) => !prev)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: isRunning ? 'default' : 'pointer',
                  userSelect: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                  <Terminal size={16} color="#0F172A" />
                  <h4
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 700,
                      color: '#0F172A',
                      margin: 0,
                      fontFamily: 'var(--font-display)',
                    }}
                  >
                    {isRunning ? 'Agent Execution in Progress (Live SSE Feed)' : 'Agent Tool Execution Audit Trail'}
                  </h4>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <span style={{ fontSize: '0.725rem', color: '#64748B', fontWeight: 600 }}>
                    {steps.length} tool calls {isRunning ? 'executing...' : 'verified'}
                  </span>
                  {isRunning && (
                    <span
                      style={{
                        color: '#D97706',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        fontSize: '0.725rem',
                        fontWeight: 600,
                      }}
                    >
                      <span
                        style={{
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          backgroundColor: '#D97706',
                          display: 'inline-block',
                        }}
                        className="pulse-indicator"
                      />
                      Active
                    </span>
                  )}
                  {!isRunning && (
                    <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
                      {isTraceExpanded ? '▲ Hide Trace' : '▼ View Trace'}
                    </span>
                  )}
                </div>
              </div>

              {(isRunning || isTraceExpanded) && (
                <div
                  style={{
                    marginTop: '0.85rem',
                    backgroundColor: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: '6px',
                    padding: '0.75rem',
                    maxHeight: '320px',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                  }}
                >
                  {steps.map((st, idx) => {
                    const isExpanded = !!expandedSteps[idx];
                    const toolName = st.tool || 'graph_query';
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
                          padding: '0.6rem 0.85rem',
                          fontSize: '0.775rem',
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
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                            {isExpanded ? (
                              <ChevronDown size={14} color="#64748B" />
                            ) : (
                              <ChevronRight size={14} color="#64748B" />
                            )}
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.45rem',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: '0.675rem',
                                  fontWeight: 700,
                                  padding: '0.1rem 0.4rem',
                                  borderRadius: '4px',
                                  backgroundColor: '#F1F5F9',
                                  color: '#334155',
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                Step {st.step || st.index || idx + 1}
                              </span>
                              <span style={{ color: '#0F172A', fontWeight: 700, fontSize: '0.8rem', fontFamily: 'var(--font-display)' }}>
                                {formatToolName(toolName)}
                              </span>
                            </span>
                          </div>
                          <span style={{ color: '#64748B', fontSize: '0.7rem' }}>
                            {hasEvidence ? 'Evidence cited' : 'Verified'}
                          </span>
                        </div>

                        {st.summary && (
                          <div
                            style={{
                              marginTop: '0.35rem',
                              color: '#334155',
                              fontFamily: 'var(--font-body)',
                              fontSize: '0.8rem',
                              lineHeight: 1.5,
                            }}
                          >
                            <MarkdownViewer content={st.summary} inlineOnly />
                          </div>
                        )}

                        {hasEvidence && (
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '0.35rem',
                              marginTop: '0.45rem',
                              alignItems: 'center',
                            }}
                          >
                            <span style={{ fontSize: '0.675rem', color: '#64748B', fontWeight: 600 }}>Entities:</span>
                            {st.evidence?.account_ids?.map((acc) => (
                              <button
                                key={acc}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onInspectAccount(acc);
                                }}
                                className="rt-badge rt-badge-gray mono"
                                style={{ fontSize: '0.675rem', cursor: 'pointer' }}
                              >
                                {acc}
                              </button>
                            ))}
                            {st.evidence?.tx_ids?.map((tx) => (
                              <span
                                key={tx}
                                className="rt-badge rt-badge-gray mono"
                                style={{ fontSize: '0.675rem' }}
                              >
                                {tx}
                              </span>
                            ))}
                          </div>
                        )}

                        {isExpanded && st.args && renderStepParameters(st.args)}
                      </div>
                    );
                  })}
                  <div ref={stepsEndRef} />
                </div>
              )}

              {streamError && (
                <div
                  style={{
                    marginTop: '0.75rem',
                    padding: '0.6rem 0.85rem',
                    backgroundColor: '#FEF2F2',
                    border: '1px solid #FECACA',
                    borderRadius: '6px',
                    color: '#DC2626',
                    fontSize: '0.775rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <AlertCircle size={14} />
                  <span>{streamError}</span>
                </div>
              )}
            </div>
          )}

        <InvestigationTools
          caseId={activeCaseId}
          caseStatus={caseStatus}
          onHighlight={onHighlight}
        />

        {/* Memory precedents stay below the investigation assistant tools. */}
        <MemoryPanel
          caseId={activeCaseId}
          onSelectCase={(cId) => {
            setSelectedCaseId(cId);
          }}
          onSimilarCasesLoaded={(items) => setSimilarCaseCount(items.length)}
          refreshTrigger={refreshTrigger}
        />
      </div>
    </div>
  );
};

export default InvestigationPanel;

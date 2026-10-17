import React, { useState } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  Eye,
  Loader2,
  UserCheck,
  XCircle,
  ShieldAlert,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { ringtraceApi } from '../../services/api';
import { MarkdownViewer } from './MarkdownViewer';

export interface DecisionBarProps {
  caseId: string | null;
  currentStatus?: string;
  embedded?: boolean;
  proposedAction?: {
    action_id: string;
    type: string;
    status: string;
    details?: any;
    reason?: string;
  } | null;
  onDecisionRecorded: (decision: any) => void;
}

export const DecisionBar: React.FC<DecisionBarProps> = ({
  caseId,
  currentStatus = 'open',
  embedded = false,
  proposedAction,
  onDecisionRecorded,
}) => {
  const [actor, setActor] = useState<string>('analyst_1');
  const [note, setNote] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleRecordDecision = async (decision: 'escalate' | 'monitor' | 'dismiss') => {
    if (!caseId) return;
    setLoading(true);
    setFeedback(null);
    try {
      const res = await ringtraceApi.recordDecision(
        caseId,
        decision,
        note.trim() || `Analyst manual ${decision} action recorded via investigation workspace.`,
        actor || 'compliance_officer'
      );

      setFeedback({
        type: 'success',
        message: `Decision recorded: ${res.decision.toUpperCase()} (${res.decision_id}). Case status transitioned to '${
          res.decision === 'escalate' ? 'escalated' : res.decision === 'monitor' ? 'monitoring' : 'dismissed'
        }'.`,
      });
      setNote('');
      onDecisionRecorded(res);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to record decision.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApproveAction = async () => {
    if (!proposedAction?.action_id) return;
    setLoading(true);
    setFeedback(null);
    try {
      const res = await ringtraceApi.approveAction(proposedAction.action_id);
      setFeedback({
        type: 'success',
        message: `Recommendation '${proposedAction.type.toUpperCase()}' approved! Logged decision: ${
          res.decision?.decision_id || 'OK'
        }.`,
      });
      onDecisionRecorded(res.decision);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to approve recommendation.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRejectAction = async () => {
    if (!proposedAction?.action_id) return;
    setLoading(true);
    setFeedback(null);
    try {
      await ringtraceApi.rejectAction(proposedAction.action_id);
      setFeedback({
        type: 'success',
        message: `Recommendation '${proposedAction.type.toUpperCase()}' rejected by compliance supervisor.`,
      });
      onDecisionRecorded(null);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to reject recommendation.',
      });
    } finally {
      setLoading(false);
    }
  };

  const isEscalate =
    proposedAction?.type === 'escalate' || proposedAction?.type === 'draft_sar';
  const isMonitor = proposedAction?.type === 'monitor';

  return (
    <div
      className={embedded ? '' : 'rt-card'}
      style={
        embedded
          ? { marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid #E2E8F0' }
          : {
              padding: '1.25rem',
              marginTop: '1.25rem',
              border: '1px solid #E2E8F0',
              backgroundColor: '#FFFFFF',
              boxShadow: 'var(--shadow-card)',
            }
      }
    >
      {/* Header Authority Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div
            style={{
              padding: '0.35rem',
              borderRadius: '6px',
              backgroundColor: '#F1F5F9',
              color: '#0F172A',
              border: '1px solid #E2E8F0',
            }}
          >
            <UserCheck size={17} />
          </div>
          <div>
            <h4
              style={{
                fontSize: '0.925rem',
                fontWeight: 700,
                color: '#0F172A',
                margin: 0,
                fontFamily: 'var(--font-display)',
              }}
            >
              Human-in-the-Loop Decision Authority
            </h4>
            <div style={{ fontSize: '0.725rem', color: '#64748B', marginTop: '0.1rem' }}>
              Target: <span className="mono" style={{ color: '#0F172A', fontWeight: 600 }}>{caseId || 'No Case Selected'}</span>
              {' • '}State:{' '}
              <span className="rt-badge rt-badge-gray" style={{ textTransform: 'capitalize' }}>
                {currentStatus}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 500 }}>Officer ID:</span>
          <input
            type="text"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            disabled={loading}
            style={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #CBD5E1',
              borderRadius: '6px',
              padding: '0.25rem 0.6rem',
              color: '#0F172A',
              fontSize: '0.75rem',
              width: '120px',
              fontWeight: 500,
              fontFamily: 'var(--font-mono)',
            }}
          />
        </div>
      </div>

      {/* Recommendation Banner - STRICT semantic coloring */}
      {proposedAction && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.85rem 1rem',
            borderRadius: '6px',
            backgroundColor: isEscalate ? '#FEF2F2' : isMonitor ? '#FFFBEB' : '#ECFDF5',
            border: `1px solid ${isEscalate ? '#FECACA' : isMonitor ? '#FDE68A' : '#A7F3D0'}`,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', flex: 1, minWidth: '260px' }}>
            <div style={{ marginTop: '0.15rem' }}>
              {isEscalate ? (
                <ShieldAlert size={18} color="#DC2626" />
              ) : isMonitor ? (
                <Clock size={18} color="#D97706" />
              ) : (
                <ShieldCheck size={18} color="#059669" />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: '0.825rem',
                    fontWeight: 700,
                    color: isEscalate ? '#991B1B' : isMonitor ? '#92400E' : '#065F46',
                    fontFamily: 'var(--font-display)',
                  }}
                >
                  Agent Recommendation: {proposedAction.type.toUpperCase().replace('_', ' ')}
                </span>
                <span
                  className={`rt-badge ${
                    isEscalate ? 'rt-badge-rose' : isMonitor ? 'rt-badge-amber' : 'rt-badge-emerald'
                  }`}
                  style={{ fontSize: '0.65rem', textTransform: 'uppercase' }}
                >
                  {proposedAction.status}
                </span>
              </div>
              <div
                style={{
                  fontSize: '0.775rem',
                  color: isEscalate ? '#7F1D1D' : isMonitor ? '#78350F' : '#064E3B',
                  marginTop: '0.35rem',
                  lineHeight: 1.5,
                }}
              >
                <MarkdownViewer content={proposedAction.reason || ''} inlineOnly />
              </div>
            </div>
          </div>

          {proposedAction.status === 'pending' && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleApproveAction}
                disabled={loading}
                className="rt-button rt-button-sm"
                style={{
                  backgroundColor: '#0F172A',
                  borderColor: '#0F172A',
                  color: '#FFFFFF',
                  fontWeight: 600,
                }}
              >
                {loading ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />}
                <span>Approve Action</span>
              </button>
              <button
                type="button"
                onClick={handleRejectAction}
                disabled={loading}
                className="rt-button rt-button-sm"
                style={{
                  backgroundColor: '#FFFFFF',
                  borderColor: '#CBD5E1',
                  color: '#64748B',
                  fontWeight: 600,
                }}
              >
                <XCircle size={13} />
                <span>Reject</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Case Rationale Note */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
          <label style={{ fontSize: '0.75rem', color: '#334155', fontWeight: 600 }}>
            Compliance Rationale / Case Note:
          </label>
          <span style={{ fontSize: '0.7rem', color: '#64748B' }}>Persisted permanently in audit ledger</span>
        </div>
        <input
          type="text"
          placeholder="Enter compliance decision note (e.g. SAR filed with FIU; circular loop confirmed)..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={loading}
          style={{
            width: '100%',
            backgroundColor: '#FFFFFF',
            border: '1px solid #CBD5E1',
            borderRadius: '6px',
            padding: '0.5rem 0.85rem',
            color: '#0F172A',
            fontSize: '0.8rem',
            fontFamily: 'var(--font-sans)',
          }}
        />
      </div>

      {/* Action Buttons Row - Strictly Calibrated Semantic Colors */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => handleRecordDecision('escalate')}
          disabled={loading || !caseId}
          className="rt-button rt-button-sm"
          style={{
            backgroundColor: '#FEF2F2',
            borderColor: '#FECACA',
            color: '#DC2626',
            fontWeight: 700,
          }}
        >
          {loading ? <Loader2 size={14} className="spin" /> : <AlertOctagon size={14} />}
          <span>Escalate Case</span>
        </button>

        <button
          type="button"
          onClick={() => handleRecordDecision('monitor')}
          disabled={loading || !caseId}
          className="rt-button rt-button-sm"
          style={{
            backgroundColor: '#FFFBEB',
            borderColor: '#FDE68A',
            color: '#D97706',
            fontWeight: 700,
          }}
        >
          {loading ? <Loader2 size={14} className="spin" /> : <Eye size={14} />}
          <span>Place on Monitoring</span>
        </button>

        <button
          type="button"
          onClick={() => handleRecordDecision('dismiss')}
          disabled={loading || !caseId}
          className="rt-button rt-button-sm"
          style={{
            backgroundColor: '#ECFDF5',
            borderColor: '#A7F3D0',
            color: '#059669',
            fontWeight: 700,
          }}
        >
          {loading ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
          <span>Dismiss (Benign / False Positive)</span>
        </button>
      </div>

      {/* Feedback Alert */}
      {feedback && (
        <div
          style={{
            marginTop: '0.85rem',
            padding: '0.6rem 0.85rem',
            borderRadius: '6px',
            fontSize: '0.775rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            backgroundColor: feedback.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            border: `1px solid ${feedback.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            color: feedback.type === 'success' ? '#059669' : '#DC2626',
            fontWeight: 600,
          }}
        >
          {feedback.type === 'success' ? <CheckCircle2 size={14} /> : <AlertOctagon size={14} />}
          <span>{feedback.message}</span>
        </div>
      )}
    </div>
  );
};

export default DecisionBar;

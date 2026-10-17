import React, { useState } from 'react';
import {
  AlertOctagon,
  Eye,
  CheckCircle2,
  FileCheck2,
  XCircle,
  Loader2,
  UserCheck,
} from 'lucide-react';
import { ringtraceApi } from '../../services/api';
import type { DecisionRecord, ProposedAction } from '../../types';

export interface DecisionBarProps {
  caseId: string;
  currentStatus?: string;
  proposedAction?: ProposedAction | null;
  onDecisionRecorded?: (record: DecisionRecord | null) => void;
}

/**
 * DecisionBar component gives the human analyst full authority to sign off,
 * escalate, monitor, or dismiss a case, or approve/reject agent-proposed actions.
 */
export const DecisionBar: React.FC<DecisionBarProps> = ({
  caseId,
  currentStatus = 'open',
  proposedAction = null,
  onDecisionRecorded = () => {},
}) => {
  const [note, setNote] = useState('');
  const [actor, setActor] = useState('Analyst_1');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleRecordDecision = async (decisionType: 'escalate' | 'monitor' | 'dismiss') => {
    if (!caseId) return;
    setLoading(true);
    setFeedback(null);
    try {
      const defaultNotes: Record<string, string> = {
        escalate: 'Case escalated for Tier 2 compliance review.',
        monitor: 'Account flagged for 30-day transaction velocity monitoring.',
        dismiss: 'Benign pattern verified; false positive dismissal.',
      };
      const finalNote = note.trim() || defaultNotes[decisionType] || 'Analyst decision recorded.';
      const res = await ringtraceApi.recordDecision(caseId, decisionType, finalNote, actor.trim() || 'Analyst_1');
      setFeedback({
        type: 'success',
        message: `Decision recorded: ${res.decision.toUpperCase()} (${res.decision_id}). Case status transitioned to '${res.decision === 'escalate' ? 'escalated' : res.decision === 'monitor' ? 'monitoring' : 'dismissed'}'.`,
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
        message: `Proposed action '${proposedAction.type}' approved! Decision logged: ${res.decision?.decision_id || 'OK'}.`,
      });
      onDecisionRecorded(res.decision);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to approve proposed action.',
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
        message: `Proposed action '${proposedAction.type}' rejected by supervisor.`,
      });
      onDecisionRecorded(null);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to reject proposed action.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="rt-card"
      style={{
        padding: '1.25rem',
        marginTop: '1.25rem',
        border: '1px solid #E2E8F0',
        backgroundColor: '#FFFFFF',
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div style={{ padding: '0.4rem', borderRadius: '6px', backgroundColor: '#EFF6FF', color: '#0284C7', border: '1px solid #BFDBFE' }}>
            <UserCheck size={18} />
          </div>
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>Human-in-the-Loop Decision Authority</h3>
            <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '0.15rem' }}>
              Target: <span className="mono" style={{ color: '#0F172A', fontWeight: 600 }}>{caseId || 'No Case Selected'}</span>
              {' • '}Current State: <span className="rt-badge rt-badge-gray" style={{ marginLeft: '0.25rem' }}>{currentStatus}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 500 }}>Analyst Actor:</span>
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
            }}
          />
        </div>
      </div>

      {/* Proposed Action Banner if Agent emitted one */}
      {proposedAction && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            backgroundColor: proposedAction.status === 'pending' ? '#F5F3FF' : '#F8FAFC',
            border: `1px solid ${proposedAction.status === 'pending' ? '#DDD6FE' : '#E2E8F0'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <FileCheck2 size={18} color="#7C3AED" />
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0F172A' }}>
                Agent Recommendation: <span style={{ textTransform: 'uppercase', color: '#7C3AED' }}>{proposedAction.type}</span>
                <span className="rt-badge rt-badge-violet" style={{ marginLeft: '0.5rem', fontSize: '0.675rem' }}>
                  {proposedAction.status}
                </span>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '0.15rem' }}>
                {proposedAction.reason}
              </div>
            </div>
          </div>

          {proposedAction.status === 'pending' && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={handleApproveAction}
                disabled={loading}
                className="rt-button rt-button-sm"
                style={{ backgroundColor: '#ECFDF5', borderColor: '#6EE7B7', color: '#047857', fontWeight: 600 }}
              >
                {loading ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />}
                Approve {proposedAction.type === 'draft_sar' ? 'SAR Filing' : 'Action'}
              </button>
              <button
                onClick={handleRejectAction}
                disabled={loading}
                className="rt-button rt-button-sm"
                style={{ backgroundColor: '#FEF2F2', borderColor: '#FCA5A5', color: '#B91C1C', fontWeight: 600 }}
              >
                <XCircle size={13} />
                Reject
              </button>
            </div>
          )}
        </div>
      )}

      {/* Analyst Compliance Rationale Note */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
          <label style={{ fontSize: '0.75rem', color: '#334155', fontWeight: 600 }}>
            Compliance Audit Rationale / Case Note:
          </label>
          <span style={{ fontSize: '0.7rem', color: '#64748B' }}>Required for audit trail</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            placeholder="e.g., Reviewed circular transfer structure; corroborated with counterpart KYC documents..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={loading}
            style={{
              flex: 1,
              backgroundColor: '#FFFFFF',
              border: '1px solid #CBD5E1',
              borderRadius: '6px',
              padding: '0.5rem 0.85rem',
              color: '#0F172A',
              fontSize: '0.8rem',
            }}
          />
        </div>
      </div>

      {/* Action Buttons Row */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => handleRecordDecision('escalate')}
          disabled={loading || !caseId}
          className="rt-button rt-button-sm"
          style={{
            backgroundColor: '#FEF2F2',
            borderColor: '#FCA5A5',
            color: '#B91C1C',
            fontWeight: 600,
          }}
        >
          {loading ? <Loader2 size={15} className="spin" /> : <AlertOctagon size={15} />}
          Escalate Case
        </button>

        <button
          onClick={() => handleRecordDecision('monitor')}
          disabled={loading || !caseId}
          className="rt-button rt-button-sm"
          style={{
            backgroundColor: '#FFFBEB',
            borderColor: '#FCD34D',
            color: '#B45309',
            fontWeight: 600,
          }}
        >
          {loading ? <Loader2 size={15} className="spin" /> : <Eye size={15} />}
          Place on Monitoring
        </button>

        <button
          onClick={() => handleRecordDecision('dismiss')}
          disabled={loading || !caseId}
          className="rt-button rt-button-sm"
          style={{
            backgroundColor: '#ECFDF5',
            borderColor: '#6EE7B7',
            color: '#047857',
            fontWeight: 600,
          }}
        >
          {loading ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
          Dismiss (Benign / False Positive)
        </button>
      </div>

      {/* Feedback banner */}
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
            border: `1px solid ${feedback.type === 'success' ? '#6EE7B7' : '#FCA5A5'}`,
            color: feedback.type === 'success' ? '#047857' : '#B91C1C',
            fontWeight: 500,
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

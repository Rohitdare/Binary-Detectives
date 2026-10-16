import React, { useState } from 'react';
import {
  AlertOctagon,
  Eye,
  CheckCircle2,
  FileCheck2,
  XCircle,
  Loader2,
  UserCheck
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
        dismiss: 'Benign pattern verified; false positive dismissal.'
      };
      const finalNote = note.trim() || defaultNotes[decisionType] || 'Analyst decision recorded.';
      const res = await ringtraceApi.recordDecision(caseId, decisionType, finalNote, actor.trim() || 'Analyst_1');
      setFeedback({
        type: 'success',
        message: `Decision recorded: ${res.decision.toUpperCase()} (${res.decision_id}). Case status transitioned to '${res.decision === 'escalate' ? 'escalated' : res.decision === 'monitor' ? 'monitoring' : 'dismissed'}'.`
      });
      setNote('');
      onDecisionRecorded(res);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to record decision.'
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
        message: `Proposed action '${proposedAction.type}' approved! Decision logged: ${res.decision?.decision_id || 'OK'}.`
      });
      onDecisionRecorded(res.decision);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to approve proposed action.'
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
        message: `Proposed action '${proposedAction.type}' rejected by supervisor.`
      });
      onDecisionRecorded(null);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to reject proposed action.'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="rt-card"
      style={{
        marginTop: '1.25rem',
        border: '1px solid rgba(56, 189, 248, 0.25)',
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div style={{ padding: '0.35rem', borderRadius: '6px', backgroundColor: 'rgba(56, 189, 248, 0.15)', color: 'var(--accent-cyan)' }}>
            <UserCheck size={18} />
          </div>
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Human-in-the-Loop Decision Authority</h3>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Target: <span className="mono" style={{ color: 'var(--accent-cyan)' }}>{caseId || 'No Case Selected'}</span>
              {' • '}Current State: <span className="rt-badge badge-personal">{currentStatus}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Analyst Actor:</span>
          <input
            type="text"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            disabled={loading}
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              padding: '0.25rem 0.6rem',
              color: 'var(--text-primary)',
              fontSize: '0.75rem',
              width: '110px'
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
            borderRadius: '6px',
            backgroundColor: proposedAction.status === 'pending' ? 'rgba(168, 85, 247, 0.12)' : 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${proposedAction.status === 'pending' ? 'rgba(168, 85, 247, 0.3)' : 'var(--border-subtle)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <FileCheck2 size={18} color="var(--accent-purple)" />
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Agent Recommendation: <span style={{ textTransform: 'uppercase', color: 'var(--accent-purple)' }}>{proposedAction.type}</span>
                <span className="rt-badge" style={{ marginLeft: '0.5rem', fontSize: '0.675rem' }}>
                  {proposedAction.status}
                </span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
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
                style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.35)', color: 'var(--accent-emerald)' }}
              >
                {loading ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />}
                Approve {proposedAction.type === 'draft_sar' ? 'SAR Filing' : 'Action'}
              </button>
              <button
                onClick={handleRejectAction}
                disabled={loading}
                className="rt-button rt-button-sm"
                style={{ backgroundColor: 'rgba(244, 63, 94, 0.12)', borderColor: 'rgba(244, 63, 94, 0.3)', color: 'var(--accent-rose)' }}
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
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
            Compliance Audit Rationale / Case Note:
          </label>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Required for audit trail</span>
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
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '0.5rem 0.85rem',
              color: 'var(--text-primary)',
              fontSize: '0.8rem'
            }}
          />
        </div>
      </div>

      {/* Action Buttons Row */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => handleRecordDecision('escalate')}
          disabled={loading || !caseId}
          className="rt-button"
          style={{
            backgroundColor: 'rgba(244, 63, 94, 0.15)',
            borderColor: 'rgba(244, 63, 94, 0.4)',
            color: 'var(--accent-rose)',
            fontWeight: 600
          }}
        >
          {loading ? <Loader2 size={15} className="spin" /> : <AlertOctagon size={15} />}
          Escalate Case
        </button>

        <button
          onClick={() => handleRecordDecision('monitor')}
          disabled={loading || !caseId}
          className="rt-button"
          style={{
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            borderColor: 'rgba(245, 158, 11, 0.4)',
            color: 'var(--accent-amber)',
            fontWeight: 600
          }}
        >
          {loading ? <Loader2 size={15} className="spin" /> : <Eye size={15} />}
          Place on Monitoring
        </button>

        <button
          onClick={() => handleRecordDecision('dismiss')}
          disabled={loading || !caseId}
          className="rt-button"
          style={{
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            borderColor: 'rgba(16, 185, 129, 0.4)',
            color: 'var(--accent-emerald)',
            fontWeight: 600
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
            backgroundColor: feedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
            border: `1px solid ${feedback.type === 'success' ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)'}`,
            color: feedback.type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-rose)'
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

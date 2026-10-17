import React, { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, Bot, FileText, Loader2, MessageCircle, Send, ShieldCheck } from 'lucide-react';
import { ringtraceApi } from '../../services/api';
import type { CaseChatMessage, CaseChatResponse, SarDraft } from '../../types';
import { MarkdownViewer } from './MarkdownViewer';

interface InvestigationToolsProps {
  caseId: string | null;
  caseStatus: string;
  onHighlight?: (evidence: { account_ids: string[]; tx_ids: string[] }) => void;
}

type ChatTurn = CaseChatMessage & {
  verified?: boolean;
  evidence?: CaseChatResponse['evidence'];
};

const sectionStyle: React.CSSProperties = {
  borderTop: '1px solid #E2E8F0',
  paddingTop: '1.15rem',
  marginTop: '1rem',
};

export const InvestigationTools: React.FC<InvestigationToolsProps> = ({
  caseId,
  caseStatus,
  onHighlight = () => {},
}) => {
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [sar, setSar] = useState<SarDraft | null>(null);
  const [sarBusy, setSarBusy] = useState(false);
  const [sarError, setSarError] = useState<string | null>(null);
  const [sarNotice, setSarNotice] = useState<string | null>(null);
  const [loadingSar, setLoadingSar] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const activeCaseIdRef = useRef(caseId);

  useEffect(() => {
    activeCaseIdRef.current = caseId;
    setChat([]);
    setQuestion('');
    setChatError(null);
    setChatBusy(false);
    setSar(null);
    setSarError(null);
    setSarNotice(null);
    setSarBusy(false);
    if (!caseId) return;

    let current = true;
    setLoadingSar(true);
    ringtraceApi.getCaseSar(caseId)
      .then((result) => {
        if (current) setSar(result);
      })
      .catch((error: any) => {
        if (current && error?.status !== 404) setSarError(error?.message || 'Could not load the SAR draft.');
      })
      .finally(() => {
        if (current) setLoadingSar(false);
      });

    return () => {
      current = false;
    };
  }, [caseId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chat, chatBusy]);

  const submitQuestion = async (event: FormEvent) => {
    event.preventDefault();
    const message = question.trim();
    if (!caseId || !message || chatBusy) return;

    const priorTurns = chat.slice(-8).map(({ role, content }) => ({ role, content }));
    setChat((current) => [...current, { role: 'user', content: message }]);
    setQuestion('');
    setChatError(null);
    setChatBusy(true);
    try {
      const response = await ringtraceApi.askCase(caseId, message, priorTurns);
      if (activeCaseIdRef.current === caseId) {
        setChat((current) => [...current, {
          role: 'assistant',
          content: response.reply,
          verified: response.verified,
          evidence: response.evidence,
        }]);
      }
    } catch (error: any) {
      if (activeCaseIdRef.current === caseId) {
        setChatError(error?.message || 'The case assistant could not answer. Please try again.');
      }
    } finally {
      if (activeCaseIdRef.current === caseId) setChatBusy(false);
    }
  };

  const generateSar = async () => {
    if (!caseId || sarBusy) return;
    setSarBusy(true);
    setSarError(null);
    setSarNotice(null);
    try {
      const result = await ringtraceApi.generateCaseSar(caseId, Boolean(sar));
      if (activeCaseIdRef.current === caseId) {
        setSar(result);
        setSarNotice('Draft saved for analyst review.');
      }
    } catch (error: any) {
      if (activeCaseIdRef.current === caseId) setSarError(error?.message || 'Could not generate the SAR draft.');
    } finally {
      if (activeCaseIdRef.current === caseId) setSarBusy(false);
    }
  };

  const canGenerateSar = caseStatus === 'escalated' || caseStatus === 'sar_drafted';

  return (
    <section style={sectionStyle} aria-label="Investigation assistant tools">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.85rem' }}>
        <Bot size={17} color="#475569" />
        <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#0F172A', fontFamily: 'var(--font-display)' }}>
          Case assistant
        </h3>
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>Read-only questions and report drafts</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '1.25rem' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.55rem' }}>
            <MessageCircle size={15} color="#475569" />
            <strong style={{ fontSize: '0.8rem', color: '#334155' }}>Ask about this case</strong>
          </div>
          <div
            aria-live="polite"
            style={{
              minHeight: '120px',
              maxHeight: '260px',
              overflowY: 'auto',
              padding: '0.65rem 0',
              borderTop: '1px solid #E2E8F0',
              borderBottom: '1px solid #E2E8F0',
            }}
          >
            {chat.length === 0 && (
              <p style={{ margin: 0, color: '#64748B', fontSize: '0.8rem', lineHeight: 1.5 }}>
                Ask about the transfers, accounts, or recorded findings. Answers use case evidence and do not change decisions.
              </p>
            )}
            {chat.map((turn, index) => (
              <div key={`${index}-${turn.role}`} style={{ marginBottom: '0.8rem' }}>
                <div style={{ fontSize: '0.68rem', color: '#64748B', textTransform: 'uppercase', marginBottom: '0.2rem' }}>
                  {turn.role === 'user' ? 'You' : 'Case assistant'}
                  {turn.role === 'assistant' && (
                    <span style={{ marginLeft: '0.5rem', color: turn.verified ? '#047857' : '#B45309' }}>
                      {turn.verified ? 'Verified against evidence' : 'Not fully verified or saved'}
                    </span>
                  )}
                </div>
                <div style={{ color: '#1E293B', fontSize: '0.8rem', lineHeight: 1.55 }}>
                  <MarkdownViewer content={turn.content} />
                </div>
                {turn.evidence && (turn.evidence.account_ids.length > 0 || turn.evidence.tx_ids.length > 0) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.35rem' }}>
                    {[...turn.evidence.account_ids, ...turn.evidence.tx_ids].map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="rt-badge rt-badge-gray mono"
                        onClick={() => onHighlight({
                          account_ids: turn.evidence?.account_ids || [],
                          tx_ids: turn.evidence?.tx_ids || [],
                        })}
                        style={{ cursor: 'pointer', fontSize: '0.66rem' }}
                        title="Highlight this answer's evidence in the graph"
                      >
                        {id}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {chatBusy && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748B', fontSize: '0.78rem' }}>
                <Loader2 size={14} className="spin" /> Checking case evidence…
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {chatError && <p role="alert" style={{ color: '#B91C1C', fontSize: '0.75rem', margin: '0.45rem 0' }}>{chatError}</p>}
          <form onSubmit={submitQuestion} style={{ display: 'flex', gap: '0.45rem', marginTop: '0.55rem' }}>
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={1000}
              disabled={!caseId || chatBusy}
              placeholder="Ask a question about the evidence…"
              aria-label="Question about this case"
              style={{
                flex: 1,
                minWidth: 0,
                border: '1px solid #CBD5E1',
                borderRadius: '6px',
                padding: '0.55rem 0.7rem',
                fontSize: '0.8rem',
              }}
            />
            <button
              type="submit"
              disabled={!caseId || chatBusy || !question.trim()}
              className="rt-button rt-button-primary rt-button-sm"
              aria-label="Send question"
            >
              {chatBusy ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
              <span>Ask</span>
            </button>
          </form>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.55rem' }}>
            <FileText size={15} color="#475569" />
            <strong style={{ fontSize: '0.8rem', color: '#334155' }}>SAR draft</strong>
            {sar && <span className="rt-badge rt-badge-gray mono" style={{ fontSize: '0.65rem' }}>{sar.sar_id}</span>}
          </div>
          {!sar && (
            <p style={{ margin: '0.35rem 0 0.65rem', color: '#64748B', fontSize: '0.78rem', lineHeight: 1.5 }}>
              {loadingSar ? 'Checking for a saved draft…' : 'A draft can be created after the case is escalated. It is a review document, not a fraud determination.'}
            </p>
          )}
          <button
            type="button"
            onClick={generateSar}
            disabled={!caseId || sarBusy}
            className="rt-button rt-button-sm"
            style={{
              backgroundColor: canGenerateSar ? '#0F172A' : '#F1F5F9',
              borderColor: canGenerateSar ? '#0F172A' : '#CBD5E1',
              color: canGenerateSar ? '#FFFFFF' : '#64748B',
              fontWeight: 600,
            }}
            title={canGenerateSar ? 'Generate a deterministic SAR draft' : 'The server will require an escalation decision'}
          >
            {sarBusy ? <Loader2 size={14} className="spin" /> : <FileText size={14} />}
            <span>{sarBusy ? 'Generating…' : sar ? 'Regenerate draft' : 'Generate SAR draft'}</span>
          </button>
          {!canGenerateSar && (
            <p style={{ margin: '0.45rem 0 0', color: '#64748B', fontSize: '0.7rem' }}>
              Escalate the case first. The server checks the latest analyst decision before saving a draft.
            </p>
          )}
          {sarNotice && (
            <p role="status" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#047857', fontSize: '0.75rem', margin: '0.5rem 0' }}>
              <ShieldCheck size={14} /> {sarNotice}
            </p>
          )}
          {sarError && (
            <p role="alert" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#B91C1C', fontSize: '0.75rem', margin: '0.5rem 0' }}>
              <AlertCircle size={14} /> {sarError}
            </p>
          )}
          {sar && (
            <div style={{ marginTop: '0.75rem', borderTop: '1px solid #E2E8F0', paddingTop: '0.7rem' }}>
              <div style={{ color: '#0F172A', fontWeight: 650, fontSize: '0.8rem', marginBottom: '0.4rem' }}>{sar.summary}</div>
              <div style={{ maxHeight: '220px', overflowY: 'auto', color: '#334155', fontSize: '0.77rem', lineHeight: 1.55 }}>
                <MarkdownViewer content={sar.narrative} />
              </div>
              <div style={{ marginTop: '0.5rem', color: '#64748B', fontSize: '0.68rem' }}>
                {sar.evidence.account_ids.length} accounts · {sar.evidence.tx_ids.length} transfers · Saved {new Date(sar.created_at).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#64748B', fontSize: '0.68rem', marginTop: '0.7rem' }}>
        <ShieldCheck size={13} /> Chat is read-only. SAR drafts require an analyst escalation and remain subject to review.
      </div>
    </section>
  );
};

export default InvestigationTools;

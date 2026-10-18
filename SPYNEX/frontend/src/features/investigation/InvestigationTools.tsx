import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, FileText, Loader2, ShieldCheck } from 'lucide-react';
import { ringtraceApi } from '../../services/api';
import type { SarDraft } from '../../types';
import { MarkdownViewer } from './MarkdownViewer';

interface InvestigationToolsProps {
  caseId: string | null;
  caseStatus: string;
  onHighlight?: (evidence: { account_ids: string[]; tx_ids: string[] }) => void;
}

const sectionStyle: React.CSSProperties = {
  borderTop: '1px solid #E2E8F0',
  paddingTop: '1.15rem',
  marginTop: '1rem',
};

export const InvestigationTools: React.FC<InvestigationToolsProps> = ({
  caseId,
  caseStatus,
}) => {
  const [sar, setSar] = useState<SarDraft | null>(null);
  const [sarBusy, setSarBusy] = useState(false);
  const [sarError, setSarError] = useState<string | null>(null);
  const [sarNotice, setSarNotice] = useState<string | null>(null);
  const [loadingSar, setLoadingSar] = useState(false);
  const activeCaseIdRef = useRef(caseId);

  useEffect(() => {
    activeCaseIdRef.current = caseId;
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
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.55rem' }}>
          <FileText size={16} color="#475569" />
          <strong style={{ fontSize: '0.85rem', color: '#1E293B', fontFamily: 'var(--font-display)' }}>SAR draft report</strong>
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

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#64748B', fontSize: '0.68rem', marginTop: '0.7rem' }}>
        <ShieldCheck size={13} /> SAR drafts require an analyst escalation and remain subject to regulatory review.
      </div>
    </section>
  );
};

export default InvestigationTools;

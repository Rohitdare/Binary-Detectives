import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { CaseDetail, CaseGraphData } from '../../types';
import { ringtraceApi } from '../../services/api';
import { CaseDetailView } from './CaseDetailView';
import { User, X, ArrowRight } from 'lucide-react';

interface CaseInvestigationViewProps {
  caseId: string;
  onBack: () => void;
  onInspectAccount: (accountId: string) => void;
  onLaunchAgentInvestigation: (caseId: string) => void;
}

export const CaseInvestigationView: React.FC<CaseInvestigationViewProps> = ({
  caseId,
  onBack,
  onInspectAccount,
  onLaunchAgentInvestigation,
}) => {
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [caseGraph, setCaseGraph] = useState<CaseGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status?: number; code?: string; message: string } | null>(null);

  // Account slide-over drawer
  const [drawerAccount, setDrawerAccount] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchCaseData = useCallback(async (id: string) => {
    setCaseDetail(null);
    setCaseGraph(null);
    setError(null);
    setLoading(true);

    try {
      const [detailRes, graphRes] = await Promise.all([
        ringtraceApi.getCase(id),
        ringtraceApi.getCaseGraph(id),
      ]);

      if (isMountedRef.current) {
        setCaseDetail(detailRes);
        setCaseGraph(graphRes);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError({
          status: err?.status || 500,
          code: err?.data?.error?.code || 'error',
          message: err?.message || 'Failed to load case detail and evidence graph',
        });
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchCaseData(caseId);
  }, [caseId, fetchCaseData]);

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: '1440px', margin: '0 auto' }}>
      <CaseDetailView
        caseDetail={caseDetail}
        caseGraph={caseGraph}
        loading={loading}
        error={error}
        onBack={onBack}
        onSelectAccount={(accId) => setDrawerAccount(accId)}
        onRetry={() => void fetchCaseData(caseId)}
        onLaunchAgentInvestigation={onLaunchAgentInvestigation}
      />

      {/* Account Drawer Slide-Over */}
      {drawerAccount && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            width: '380px',
            height: '100vh',
            backgroundColor: '#FFFFFF',
            boxShadow: 'var(--shadow-popover)',
            borderLeft: '1px solid var(--border-medium)',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            padding: '1.5rem',
            gap: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '9px',
                  backgroundColor: 'var(--surface-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--brand-purple)',
                }}
              >
                <User size={18} />
              </div>
              <div>
                <h3 className="mono" style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  {drawerAccount}
                </h3>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Entity Inspection</span>
              </div>
            </div>
            <button
              onClick={() => setDrawerAccount(null)}
              className="rt-button rt-button-sm"
              style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
            >
              <X size={18} />
            </button>
          </div>

          <div
            className="rt-card"
            style={{
              padding: '1.15rem',
              backgroundColor: '#F8FAFC',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Selected entity from case graph evidence. You can view its concentric 1-hop neighborhood or complete inflow/outflow ledger in Transaction Explorer.
            </div>
            <button
              onClick={() => {
                const target = drawerAccount;
                setDrawerAccount(null);
                onInspectAccount(target);
              }}
              className="rt-button rt-button-primary"
              style={{
                gap: '0.5rem',
                justifyContent: 'center',
                marginTop: '0.5rem',
                backgroundColor: 'var(--brand-purple)',
                borderColor: 'var(--brand-purple)',
                color: '#FFFFFF',
              }}
            >
              <span>Open in Transaction Explorer</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

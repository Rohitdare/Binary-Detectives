import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { CaseRecord, CaseDetail, CaseGraphData } from '../../types';
import { ringtraceApi } from '../../services/api';
import { CaseQueueList } from './CaseQueueList';
import { CaseDetailView } from './CaseDetailView';
import { X, ArrowRight, User } from 'lucide-react';

interface CaseManagementViewProps {
  onInspectAccount: (accountId: string) => void;
  initialCaseId?: string | null;
}

export const CaseManagementView: React.FC<CaseManagementViewProps> = ({
  onInspectAccount,
  initialCaseId = null,
}) => {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(initialCaseId);
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [caseGraph, setCaseGraph] = useState<CaseGraphData | null>(null);

  const [loadingCases, setLoadingCases] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<{ status?: number; code?: string; message: string } | null>(null);

  // Scan state
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterSeverity, setFilterSeverity] = useState<string>('');
  const [filterPattern, setFilterPattern] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('score');

  // Account Drawer
  const [drawerAccount, setDrawerAccount] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchCases = useCallback(async () => {
    setLoadingCases(true);
    try {
      const res = await ringtraceApi.getCases({
        status: filterStatus || undefined,
        severity: filterSeverity || undefined,
        pattern: filterPattern || undefined,
        sort: sortBy,
        limit: 100,
      });
      if (isMountedRef.current) {
        setCases(res.items);
        // Auto-select first case if none selected
        if (!selectedCaseId && res.items.length > 0) {
          setSelectedCaseId(res.items[0].case_id);
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch cases:', err);
    } finally {
      if (isMountedRef.current) {
        setLoadingCases(false);
      }
    }
  }, [filterStatus, filterSeverity, filterPattern, sortBy, selectedCaseId]);

  useEffect(() => {
    void fetchCases();
  }, [fetchCases]);

  // Load Case Detail and Case Graph with strict stale-data prevention
  const fetchCaseDetail = useCallback(async (caseId: string) => {
    // Crucial: immediately clear previous case detail and graph
    setCaseDetail(null);
    setCaseGraph(null);
    setDetailError(null);
    setLoadingDetail(true);

    try {
      const [detailRes, graphRes] = await Promise.all([
        ringtraceApi.getCase(caseId),
        ringtraceApi.getCaseGraph(caseId),
      ]);

      if (isMountedRef.current) {
        setCaseDetail(detailRes);
        setCaseGraph(graphRes);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setDetailError({
          status: err?.status || 500,
          code: err?.data?.error?.code || 'error',
          message: err?.message || 'Failed to load case detail',
        });
      }
    } finally {
      if (isMountedRef.current) {
        setLoadingDetail(false);
      }
    }
  }, []);

  useEffect(() => {
    if (selectedCaseId) {
      void fetchCaseDetail(selectedCaseId);
    } else {
      setCaseDetail(null);
      setCaseGraph(null);
      setDetailError(null);
    }
  }, [selectedCaseId, fetchCaseDetail]);

  // Scan pipeline trigger and polling
  const handleTriggerScan = async () => {
    setIsScanning(true);
    setScanProgress('Initiating scan...');
    try {
      const receipt = await ringtraceApi.startScan();
      const scanId = receipt.scan_id;
      setScanProgress('Running detectors...');

      // Poll until complete
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await ringtraceApi.getScanStatus(scanId);
          if (statusRes.status === 'completed' || statusRes.status === 'complete' || statusRes.status === 'partial') {
            clearInterval(pollInterval);
            if (isMountedRef.current) {
              setIsScanning(false);
              setScanProgress(null);
              void fetchCases();
            }
          } else if (statusRes.status === 'failed') {
            clearInterval(pollInterval);
            if (isMountedRef.current) {
              setIsScanning(false);
              setScanProgress(null);
              alert('Scan failed to complete.');
            }
          }
        } catch {
          // ignore transient polling errors
        }
      }, 1500);
    } catch (err: any) {
      setIsScanning(false);
      setScanProgress(null);
      alert(`Failed to trigger scan: ${err?.message || 'Unknown error'}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', position: 'relative' }}>
      {/* Layout Split */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '360px 1fr',
          gap: '1.25rem',
          alignItems: 'start',
        }}
      >
        {/* Left Column: Case Queue */}
        <div className="rt-card" style={{ padding: '1rem', minHeight: '600px' }}>
          <CaseQueueList
            cases={cases}
            selectedCaseId={selectedCaseId}
            onSelectCase={(id) => setSelectedCaseId(id)}
            loading={loadingCases}
            isScanning={isScanning}
            scanProgress={scanProgress}
            onTriggerScan={handleTriggerScan}
            onRefresh={fetchCases}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
            filterSeverity={filterSeverity}
            setFilterSeverity={setFilterSeverity}
            filterPattern={filterPattern}
            setFilterPattern={setFilterPattern}
            sortBy={sortBy}
            setSortBy={setSortBy}
          />
        </div>

        {/* Right Column: Case Detail & Evidence Graph */}
        <div style={{ minWidth: 0 }}>
          <CaseDetailView
            caseDetail={caseDetail}
            caseGraph={caseGraph}
            loading={loadingDetail}
            error={detailError}
            onSelectAccount={(accId) => setDrawerAccount(accId)}
            onRetry={() => selectedCaseId && void fetchCaseDetail(selectedCaseId)}
          />
        </div>
      </div>

      {/* Account Drawer Slide-Over */}
      {drawerAccount ? (
        <div
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            width: '380px',
            height: '100vh',
            backgroundColor: 'var(--surface-primary)',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--brand-mint-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--brand-forest)',
                }}
              >
                <User size={18} />
              </div>
              <div>
                <h3 className="mono" style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  {drawerAccount}
                </h3>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Account Inspection</span>
              </div>
            </div>
            <button
              onClick={() => setDrawerAccount(null)}
              className="rt-button rt-button-sm"
              style={{ border: 'none', background: 'transparent' }}
            >
              <X size={18} />
            </button>
          </div>

          <div
            className="rt-card"
            style={{
              padding: '1rem',
              backgroundColor: 'var(--surface-secondary)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.65rem',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Selected entity from case graph evidence. You can view its concentric 1-hop neighborhood or complete inflow/outflow ledger in Transaction Explorer.
            </div>
            <button
              onClick={() => {
                const target = drawerAccount;
                setDrawerAccount(null);
                onInspectAccount(target);
              }}
              className="rt-button rt-button-primary"
              style={{ gap: '0.5rem', justifyContent: 'center', marginTop: '0.5rem' }}
            >
              <span>Open in Transaction Explorer</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

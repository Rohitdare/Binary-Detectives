import React, { useEffect, useState, useCallback } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Navbar } from './components/layout/Navbar';
import { OverviewGraph } from './components/overview/OverviewGraph';
import { TransactionExplorer } from './components/explorer/TransactionExplorer';
import { DetectionWorkbench } from './components/patterns/DetectionWorkbench';
import { CaseManagementView } from './components/cases/CaseManagementView';
import { PlaceholderView } from './components/common/PlaceholderView';
import type { DetectorPattern, DetectorRunSummary, HealthStatus, PageTab, SystemStats } from './types';
import { ringtraceApi } from './services/api';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<PageTab>('overview');
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);

  const [loadingHealth, setLoadingHealth] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);

  const [inspectedAccountId, setInspectedAccountId] = useState<string | null>(null);
  const [requestedDetector, setRequestedDetector] = useState<DetectorPattern | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoadingHealth(true);
    try {
      const h = await ringtraceApi.getHealth();
      setHealth(h);
      setBackendError(null);
    } catch (err: any) {
      setHealth({
        status: 'error',
        falkordb_connected: false,
        graph: 'txn',
        host: 'localhost',
        port: 6379,
        error: err?.message || 'Cannot reach FastAPI backend',
      });
      setBackendError(err?.message || 'FastAPI backend unavailable at http://localhost:8000');
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const s = await ringtraceApi.getStats();
      setStats(s);
    } catch {
      // Backend error is tracked in health check
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      if (isMounted) {
        await Promise.allSettled([fetchHealth(), fetchStats()]);
      }
    };
    void init();

    const interval = setInterval(() => {
      if (isMounted) {
        void fetchHealth();
      }
    }, 30000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [fetchHealth, fetchStats]);

  const handleSelectAccount = useCallback((accId: string) => {
    setInspectedAccountId(accId);
    setCurrentTab('explorer');
  }, []);

  const handleDetectorStatus = useCallback((_pattern: DetectorPattern, _summary: DetectorRunSummary) => {
    // Status sink for DetectionWorkbench
  }, []);

  return (
    <div className="app-container">
      <Sidebar currentTab={currentTab} onSelectTab={setCurrentTab} health={health} />

      <div className="main-content">
        <Navbar
          health={health}
          onRefreshHealth={fetchHealth}
          onSelectAccount={handleSelectAccount}
        />

        {backendError && (
          <div style={{
            backgroundColor: 'rgba(244, 63, 94, 0.1)',
            borderBottom: '1px solid rgba(244, 63, 94, 0.25)',
            padding: '0.65rem 2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: 'var(--accent-red)',
            fontSize: '0.825rem',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <AlertTriangle size={15} />
              <span>
                <strong>Backend Notice:</strong> {backendError}. Ensure the server is running on <code className="mono">port 8000</code>.
              </span>
            </div>
            <button
              onClick={() => { void fetchHealth(); void fetchStats(); }}
              className="rt-button rt-button-sm"
              style={{ borderColor: 'rgba(244, 63, 94, 0.35)', color: 'var(--accent-red)' }}
            >
              <RefreshCw size={12} className={loadingHealth ? 'spin' : ''} />
              <span>Retry</span>
            </button>
          </div>
        )}

        <div className="page-body">
          {currentTab === 'overview' && (
            <OverviewGraph
              stats={stats}
              onInspectAccount={handleSelectAccount}
            />
          )}

          {currentTab === 'patterns' && (
            <DetectionWorkbench
              requestedPattern={requestedDetector}
              onInspectAccount={handleSelectAccount}
              onRunStatus={handleDetectorStatus}
              onRequestHandled={() => setRequestedDetector(null)}
            />
          )}

          {currentTab === 'explorer' && (
            <TransactionExplorer
              initialAccountId={inspectedAccountId}
              onBackToOverview={() => setCurrentTab('overview')}
            />
          )}

          {currentTab === 'investigations' && (
            <CaseManagementView
              onInspectAccount={handleSelectAccount}
            />
          )}

          {currentTab !== 'overview' && currentTab !== 'explorer' && currentTab !== 'patterns' && currentTab !== 'investigations' && (
            <PlaceholderView
              tab={currentTab}
              onBackToOverview={() => setCurrentTab('overview')}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

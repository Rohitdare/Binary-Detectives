import React, { useEffect, useState, useCallback } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Navbar } from './components/layout/Navbar';
import { SummaryCards } from './components/overview/SummaryCards';
import { NetworkPreview } from './components/overview/NetworkPreview';
import { RecentTransactionsTable } from './components/overview/RecentTransactionsTable';
import { InvestigationPanel } from './components/overview/InvestigationPanel';
import { TransactionExplorer } from './components/explorer/TransactionExplorer';
import { CycleDetectionView } from './components/patterns/CycleDetectionView';
import { PlaceholderView } from './components/common/PlaceholderView';
import type { HealthStatus, PageTab, SystemStats, TransactionRecord } from './types';
import { ringtraceApi } from './services/api';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<PageTab>('overview');
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);

  const [loadingHealth, setLoadingHealth] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingTx, setLoadingTx] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);

  const [inspectedAccountId, setInspectedAccountId] = useState<string | null>(null);

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
    setLoadingStats(true);
    try {
      const s = await ringtraceApi.getStats();
      setStats(s);
    } catch (err: any) {
      // Backend error is tracked in health check
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const fetchTransactions = useCallback(async () => {
    setLoadingTx(true);
    try {
      const txs = await ringtraceApi.getTransactions(50);
      setTransactions(txs);
    } catch {
      setTransactions([]);
    } finally {
      setLoadingTx(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    fetchStats();
    fetchTransactions();

    const interval = setInterval(() => {
      fetchHealth();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchHealth, fetchStats, fetchTransactions]);

  const handleSelectAccount = (accId: string) => {
    setInspectedAccountId(accId);
    setCurrentTab('explorer');
  };

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
            backgroundColor: 'rgba(244, 63, 94, 0.12)',
            borderBottom: '1px solid rgba(244, 63, 94, 0.3)',
            padding: '0.65rem 2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: 'var(--accent-rose)',
            fontSize: '0.825rem',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <AlertTriangle size={15} />
              <span>
                <strong>Backend Connection Notice:</strong> {backendError}. Ensure the FastAPI server is running with <code className="mono">uvicorn app.main:app --port 8000</code>.
              </span>
            </div>
            <button
              onClick={() => { fetchHealth(); fetchStats(); fetchTransactions(); }}
              className="rt-button rt-button-sm"
              style={{ borderColor: 'rgba(244, 63, 94, 0.4)', color: 'var(--accent-rose)' }}
            >
              <RefreshCw size={12} className={loadingHealth ? 'spin' : ''} />
              <span>Retry</span>
            </button>
          </div>
        )}

        <div className="page-body">
          {currentTab === 'overview' && (
            <>
              <SummaryCards stats={stats} loading={loadingStats} />
              <NetworkPreview onInspectAccount={handleSelectAccount} />
              <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'stretch', flexWrap: 'wrap' }}>
                <RecentTransactionsTable
                  transactions={transactions}
                  loading={loadingTx}
                  onSelectAccount={handleSelectAccount}
                  onRefresh={fetchTransactions}
                />
                <InvestigationPanel />
              </div>
            </>
          )}

          {currentTab === 'explorer' && (
            <TransactionExplorer
              initialAccountId={inspectedAccountId}
              onBackToOverview={() => setCurrentTab('overview')}
            />
          )}

          {currentTab === 'patterns' && (
            <CycleDetectionView
              onInspectAccount={handleSelectAccount}
            />
          )}

          {currentTab !== 'overview' && currentTab !== 'explorer' && currentTab !== 'patterns' && (
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

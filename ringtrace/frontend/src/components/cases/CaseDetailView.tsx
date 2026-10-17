import React, { useState } from 'react';
import { Copy, Check, ShieldAlert, FileText, Share2, Layers, Network, Bot } from 'lucide-react';
import type { CaseDetail, CaseGraphData } from '../../types';
import { CaseGraphCanvas } from './CaseGraphCanvas';
import { CaseScoreBreakdownView } from './CaseScoreBreakdownView';
import { CaseTransactionTable } from './CaseTransactionTable';
import { CaseHitsList } from './CaseHitsList';

interface CaseDetailViewProps {
  caseDetail: CaseDetail | null;
  caseGraph: CaseGraphData | null;
  loading: boolean;
  error: { status?: number; code?: string; message: string } | null;
  onSelectAccount: (accountId: string) => void;
  onRetry?: () => void;
  onLaunchAgentInvestigation?: (caseId: string) => void;
}

type DetailTab = 'graph' | 'transactions' | 'hits' | 'scoring';

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export const CaseDetailView: React.FC<CaseDetailViewProps> = ({
  caseDetail,
  caseGraph,
  loading,
  error,
  onSelectAccount,
  onRetry,
  onLaunchAgentInvestigation,
}) => {
  const [activeTab, setActiveTab] = useState<DetailTab>('graph');
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const handleCopyId = () => {
    if (!caseDetail) return;
    void navigator.clipboard.writeText(caseDetail.case_id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  if (loading) {
    return (
      <div
        className="rt-card"
        style={{
          padding: '3rem 2rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '450px',
          gap: '1rem',
          color: 'var(--text-muted)',
        }}
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            border: '3px solid var(--border-subtle)',
            borderTopColor: 'var(--brand-forest)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <div style={{ fontSize: '0.85rem' }}>Loading case details and evidence graph...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rt-card"
        style={{
          padding: '3rem 2rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '450px',
          gap: '1rem',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            backgroundColor: 'var(--accent-red-subtle)',
            border: '1px solid var(--accent-red-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-red)',
          }}
        >
          <ShieldAlert size={24} />
        </div>
        <div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            {error.code === 'not_found' ? 'Case Not Found (404)' : 'Error Loading Case'}
          </h3>
          <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', marginTop: '0.35rem', maxWidth: '380px' }}>
            {error.message}
          </p>
        </div>
        {onRetry ? (
          <button onClick={onRetry} className="rt-button" style={{ marginTop: '0.5rem' }}>
            Retry Request
          </button>
        ) : null}
      </div>
    );
  }

  if (!caseDetail) {
    return (
      <div
        className="rt-card"
        style={{
          padding: '3rem 2rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '450px',
          gap: '1rem',
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}
      >
        <FileText size={36} color="var(--border-medium)" />
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            No Case Selected
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Select a case from the triage queue on the left to inspect evidence, score breakdown, and transaction graph.
          </p>
        </div>
      </div>
    );
  }

  const selectedTx = selectedTxId
    ? caseDetail.transactions.find((tx) => tx.tx_id === selectedTxId) || null
    : null;

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'escalated':
        return 'rt-badge-rose';
      case 'monitoring':
        return 'rt-badge-amber';
      case 'dismissed':
        return 'rt-badge-gray';
      default:
        return 'rt-badge-emerald';
    }
  };

  const getSeverityBadge = (sev: string) => {
    switch (sev.toLowerCase()) {
      case 'high':
        return 'rt-badge-rose';
      case 'medium':
        return 'rt-badge-amber';
      default:
        return 'rt-badge-gray';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header Bar */}
      <div
        className="rt-card"
        style={{
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.85rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <h2 className="mono" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              {caseDetail.case_id}
            </h2>
            <button
              onClick={handleCopyId}
              className="rt-button rt-button-sm"
              style={{ padding: '0.2rem 0.4rem', border: 'none', background: 'var(--surface-muted)' }}
              title="Copy Case ID"
            >
              {copiedId ? <Check size={12} color="var(--brand-teal)" /> : <Copy size={12} />}
            </button>
            <span className={`rt-badge ${getSeverityBadge(caseDetail.severity)}`} style={{ textTransform: 'uppercase', fontSize: '0.7rem' }}>
              {caseDetail.severity}
            </span>
            <span className={`rt-badge ${getStatusBadge(caseDetail.status)}`} style={{ textTransform: 'capitalize', fontSize: '0.7rem' }}>
              {caseDetail.status}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {onLaunchAgentInvestigation && (
              <button
                onClick={() => onLaunchAgentInvestigation(caseDetail.case_id)}
                className="rt-button rt-button-primary rt-button-sm"
                style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.75rem', fontWeight: 600 }}
                title="Launch Member B Autonomous AI Agent on this case"
              >
                <Bot size={13} />
                <span>Investigate with AI →</span>
              </button>
            )}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.675rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Triage Score</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {caseDetail.score} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>/ 100</span>
              </div>
            </div>
          </div>
        </div>

        {/* Metric Badges */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1.5rem',
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <strong>Patterns:</strong>{' '}
            {caseDetail.patterns.map((p) => (
              <span key={p} className="rt-badge rt-badge-emerald" style={{ marginLeft: '4px', fontSize: '0.65rem' }}>
                {p.replace('_', '-')}
              </span>
            ))}
          </div>
          <div>
            <strong>Accounts:</strong> {caseDetail.account_count}
          </div>
          <div>
            <strong>Transactions:</strong> {caseDetail.tx_count}
          </div>
          <div>
            <strong>Total Flow:</strong> {currency.format(caseDetail.total_amount)}
          </div>
          {caseDetail.similar_case_count !== undefined && (
            <div>
              <strong>Similar Cases:</strong>{' '}
              <span className="rt-badge rt-badge-mint mono" style={{ fontSize: '0.675rem' }}>
                {caseDetail.similar_case_count}
              </span>
            </div>
          )}
          <div>
            <strong>Updated:</strong> {caseDetail.updated_at ? caseDetail.updated_at.substring(0, 19).replace('T', ' ') : '—'}
          </div>
        </div>
      </div>

      {/* Member B Investigation & Decision Integration Banner */}
      <div
        className="rt-card"
        style={{
          padding: '0.85rem 1.15rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'var(--surface-secondary)',
          borderLeft: '3px solid var(--brand-forest)',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <Share2 size={16} color="var(--brand-forest)" />
          <div>
            <div style={{ fontSize: '0.775rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Member B Investigation Interface
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              Bound via opaque key <code className="mono">{caseDetail.case_id}</code>. Decisions and SAR narratives written by Member B.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {caseDetail.decisions && caseDetail.decisions.length > 0 ? (
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
              <strong>Last Decision:</strong>{' '}
              <span className={`rt-badge ${getStatusBadge(caseDetail.decisions[caseDetail.decisions.length - 1].decision)}`}>
                {caseDetail.decisions[caseDetail.decisions.length - 1].decision}
              </span>{' '}
              by {caseDetail.decisions[caseDetail.decisions.length - 1].actor}
            </div>
          ) : (
            <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.675rem' }}>
              Pending Analyst Decision
            </span>
          )}
        </div>
      </div>

      {/* Tab Controls */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
        <button
          onClick={() => setActiveTab('graph')}
          className={`rt-button ${activeTab === 'graph' ? 'rt-button-primary' : ''}`}
          style={{ fontSize: '0.75rem', gap: '5px' }}
        >
          <Network size={13} />
          <span>Evidence Graph</span>
        </button>
        <button
          onClick={() => setActiveTab('transactions')}
          className={`rt-button ${activeTab === 'transactions' ? 'rt-button-primary' : ''}`}
          style={{ fontSize: '0.75rem', gap: '5px' }}
        >
          <FileText size={13} />
          <span>Transactions ({caseDetail.transactions?.length || 0})</span>
        </button>
        <button
          onClick={() => setActiveTab('hits')}
          className={`rt-button ${activeTab === 'hits' ? 'rt-button-primary' : ''}`}
          style={{ fontSize: '0.75rem', gap: '5px' }}
        >
          <Layers size={13} />
          <span>Detector Hits ({caseDetail.hits?.length || 0})</span>
        </button>
        <button
          onClick={() => setActiveTab('scoring')}
          className={`rt-button ${activeTab === 'scoring' ? 'rt-button-primary' : ''}`}
          style={{ fontSize: '0.75rem', gap: '5px' }}
        >
          <span>Score Breakdown</span>
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'graph' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <CaseGraphCanvas
            graphData={caseGraph}
            selectedTx={selectedTx}
            onSelectTx={(txId) => setSelectedTxId(txId)}
            onSelectAccount={onSelectAccount}
          />
          {caseDetail.transactions && caseDetail.transactions.length > 0 ? (
            <CaseTransactionTable
              transactions={caseDetail.transactions}
              selectedTxId={selectedTxId}
              onSelectTx={(txId) => setSelectedTxId(txId)}
              onSelectAccount={onSelectAccount}
            />
          ) : null}
        </div>
      )}

      {activeTab === 'transactions' && (
        <CaseTransactionTable
          transactions={caseDetail.transactions || []}
          selectedTxId={selectedTxId}
          onSelectTx={(txId) => setSelectedTxId(txId)}
          onSelectAccount={onSelectAccount}
        />
      )}

      {activeTab === 'hits' && (
        <CaseHitsList
          hits={caseDetail.hits || []}
          onSelectAccount={onSelectAccount}
        />
      )}

      {activeTab === 'scoring' && (
        <CaseScoreBreakdownView
          score={caseDetail.score}
          severity={caseDetail.severity}
          breakdown={caseDetail.score_breakdown}
        />
      )}
    </div>
  );
};

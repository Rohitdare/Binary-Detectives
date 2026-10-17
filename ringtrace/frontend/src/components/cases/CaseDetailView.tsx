import React, { useState } from 'react';
import {
  Copy,
  Check,
  ShieldAlert,
  FileText,
  Share2,
  Layers,
  Network,
  Bot,
  Activity,
  Zap,
  Shield,
  ArrowRight,
} from 'lucide-react';
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
          color: '#64748B',
        }}
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            border: '3px solid #E2E8F0',
            borderTopColor: '#0F172A',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>
          Loading case forensic evidence and graph topology...
        </div>
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
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#DC2626',
          }}
        >
          <ShieldAlert size={24} />
        </div>
        <div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
            {error.code === 'not_found' ? 'Case Not Found (404)' : 'Error Loading Case'}
          </h3>
          <p style={{ fontSize: '0.825rem', color: '#64748B', marginTop: '0.35rem', maxWidth: '380px' }}>
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
          color: '#64748B',
          textAlign: 'center',
        }}
      >
        <FileText size={36} color="#CBD5E1" />
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>
            No Case Selected
          </h3>
          <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '0.25rem' }}>
            Select a case from the triage queue on the left to inspect evidence, score breakdown, and transaction graph.
          </p>
        </div>
      </div>
    );
  }

  const selectedTx = selectedTxId
    ? caseDetail.transactions.find((tx) => tx.tx_id === selectedTxId) || null
    : null;

  const isHighRisk = caseDetail.score >= 70;
  const isMedRisk = caseDetail.score >= 40 && caseDetail.score < 70;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Stitch Screen 2 Sub-Header / Case Focus Strip */}
      <div
        className="rt-card"
        style={{
          padding: '1.25rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          backgroundColor: '#FFFFFF',
          border: '1px solid #E2E8F0',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          {/* Left: Identity & Badges */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem' }}>
              <span
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '1.35rem',
                  fontWeight: 800,
                  color: '#0F172A',
                  letterSpacing: '-0.02em',
                }}
              >
                {caseDetail.case_id}
              </span>
              <button
                onClick={handleCopyId}
                className="rt-button rt-button-sm"
                style={{ padding: '0.25rem 0.45rem', border: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}
                title="Copy Case ID"
              >
                {copiedId ? <Check size={12} color="#10B981" /> : <Copy size={12} color="#64748B" />}
              </button>

              {/* High Risk / Severity Badge */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.2rem 0.65rem',
                  borderRadius: '9999px',
                  backgroundColor: isHighRisk ? '#FEF2F2' : isMedRisk ? '#FFFBEB' : '#F1F5F9',
                  border: `1px solid ${isHighRisk ? '#FECACA' : isMedRisk ? '#FDE68A' : '#E2E8F0'}`,
                  color: isHighRisk ? '#991B1B' : isMedRisk ? '#92400E' : '#334155',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: isHighRisk ? '#DC2626' : isMedRisk ? '#D97706' : '#64748B',
                  }}
                />
                {caseDetail.severity || (isHighRisk ? 'HIGH RISK' : 'MEDIUM RISK')}
              </span>

              {/* Status Badge */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.2rem 0.65rem',
                  borderRadius: '9999px',
                  backgroundColor: '#F1F5F9',
                  border: '1px solid #E2E8F0',
                  color: '#1E293B',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                }}
              >
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#475569' }} />
                STATUS: {caseDetail.status || 'OPEN'}
              </span>

              {/* Triage Score Badge */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.2rem 0.65rem',
                  borderRadius: '8px',
                  backgroundColor: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#0F172A',
                }}
              >
                <span style={{ color: '#64748B' }}>Triage Score:</span>
                <span
                  style={{
                    fontSize: '1.1rem',
                    fontWeight: 800,
                    color: isHighRisk ? '#DC2626' : isMedRisk ? '#D97706' : '#059669',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  {caseDetail.score}
                </span>
                <span style={{ fontSize: '0.7rem', color: '#94A3B8' }}>/100</span>
              </div>
            </div>

            {/* Detected Typologies Pills */}
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.2rem' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Typologies:
              </span>
              {caseDetail.patterns.map((p) => (
                <span
                  key={p}
                  style={{
                    padding: '0.15rem 0.55rem',
                    borderRadius: '6px',
                    backgroundColor: '#F1F5F9',
                    border: '1px solid #E2E8F0',
                    color: '#334155',
                    fontSize: '0.725rem',
                    fontWeight: 600,
                  }}
                >
                  {p.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </span>
              ))}
            </div>
          </div>

          {/* Right: Forensic Metrics Snapshot */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1.25rem',
              paddingLeft: '1rem',
              borderLeft: '1px solid #E2E8F0',
            }}
          >
            <div>
              <span style={{ fontSize: '0.675rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                Involved Nodes
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', marginTop: '0.1rem' }}>
                <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                  {caseDetail.account_count}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#64748B' }}>Accounts</span>
              </div>
            </div>

            <div>
              <span style={{ fontSize: '0.675rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                Transactions
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', marginTop: '0.1rem' }}>
                <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                  {caseDetail.tx_count}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 600 }}>Flagged</span>
              </div>
            </div>

            <div>
              <span style={{ fontSize: '0.675rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                Total Flow
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', marginTop: '0.1rem' }}>
                <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                  {currency.format(caseDetail.total_amount)}
                </span>
              </div>
            </div>

            {onLaunchAgentInvestigation && (
              <div>
                <span style={{ fontSize: '0.675rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                  Autonomous State
                </span>
                <div style={{ marginTop: '0.15rem' }}>
                  <button
                    onClick={() => onLaunchAgentInvestigation(caseDetail.case_id)}
                    className="rt-button rt-button-primary rt-button-sm"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      fontSize: '0.725rem',
                      fontWeight: 600,
                      padding: '0.35rem 0.75rem',
                    }}
                    title="Launch Member B 8-Tool Autonomous Agent on this case"
                  >
                    <Bot size={13} />
                    <span>Launch AI Cockpit</span>
                    <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4 Top Metric Cards (Priority Score, Laundering Flow, Entities in Case, Graph Latency) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
        }}
      >
        {/* Card 1: Priority Score */}
        <div className="rt-kpi-card">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                backgroundColor: isHighRisk ? '#FEF2F2' : '#FFFBEB',
                border: `1px solid ${isHighRisk ? '#FECACA' : '#FDE68A'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isHighRisk ? '#DC2626' : '#D97706',
              }}
            >
              <Activity size={17} />
            </div>
            <span
              style={{
                padding: '0.15rem 0.45rem',
                borderRadius: '4px',
                backgroundColor: isHighRisk ? '#FEF2F2' : '#F1F5F9',
                color: isHighRisk ? '#991B1B' : '#475569',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.65rem',
                fontWeight: 700,
              }}
            >
              Rank #01
            </span>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748B' }}>Priority Score</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', marginTop: '0.2rem' }}>
              <span
                style={{
                  fontSize: '1.45rem',
                  fontWeight: 800,
                  color: isHighRisk ? '#DC2626' : '#0F172A',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {caseDetail.score}
              </span>
              <span style={{ fontSize: '0.8rem', color: '#94A3B8' }}>/100</span>
            </div>
          </div>
          <div
            style={{
              paddingTop: '0.45rem',
              borderTop: '1px solid #F1F5F9',
              fontSize: '0.725rem',
              color: '#059669',
              fontWeight: 600,
            }}
          >
            Verified Multi-Hop Typology
          </div>
        </div>

        {/* Card 2: Laundering Flow */}
        <div className="rt-kpi-card">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                backgroundColor: '#EFF6FF',
                border: '1px solid #BFDBFE',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#1D4ED8',
              }}
            >
              <Shield size={17} />
            </div>
            <span
              style={{
                padding: '0.15rem 0.45rem',
                borderRadius: '4px',
                backgroundColor: '#F1F5F9',
                color: '#334155',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.65rem',
                fontWeight: 600,
              }}
            >
              INR
            </span>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748B' }}>Total Flow Structuring</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', marginTop: '0.2rem' }}>
              <span style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                {currency.format(caseDetail.total_amount)}
              </span>
            </div>
          </div>
          <div
            style={{
              paddingTop: '0.45rem',
              borderTop: '1px solid #F1F5F9',
              fontSize: '0.725rem',
              color: '#1D4ED8',
              fontWeight: 600,
            }}
          >
            High velocity concentration
          </div>
        </div>

        {/* Card 3: Entities in Case */}
        <div className="rt-kpi-card">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                backgroundColor: '#F1F5F9',
                border: '1px solid #E2E8F0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#0F172A',
              }}
            >
              <Layers size={17} />
            </div>
            <span
              style={{
                padding: '0.15rem 0.45rem',
                borderRadius: '4px',
                backgroundColor: '#F1F5F9',
                color: '#334155',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.65rem',
                fontWeight: 600,
              }}
            >
              Subgraph
            </span>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748B' }}>Entities in Case</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <span style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                {caseDetail.account_count}
              </span>
              <span style={{ fontSize: '0.8rem', color: '#64748B' }}>Nodes</span>
            </div>
          </div>
          <div
            style={{
              paddingTop: '0.45rem',
              borderTop: '1px solid #F1F5F9',
              fontSize: '0.725rem',
              color: '#64748B',
            }}
          >
            {caseDetail.tx_count} transaction edges
          </div>
        </div>

        {/* Card 4: Graph Engine Latency */}
        <div className="rt-kpi-card">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                backgroundColor: '#ECFDF5',
                border: '1px solid #A7F3D0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#059669',
              }}
            >
              <Zap size={17} />
            </div>
            <span
              style={{
                padding: '0.15rem 0.45rem',
                borderRadius: '4px',
                backgroundColor: '#F1F5F9',
                color: '#334155',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.65rem',
                fontWeight: 600,
              }}
            >
              Shard #04
            </span>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748B' }}>Graph Latency (Cypher)</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <span style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
                0.8ms
              </span>
            </div>
          </div>
          <div
            style={{
              paddingTop: '0.45rem',
              borderTop: '1px solid #F1F5F9',
              fontSize: '0.725rem',
              color: '#059669',
              fontWeight: 600,
            }}
          >
            In-Memory Redis Graph Index
          </div>
        </div>
      </div>

      {/* Member B Interface & Decision Sync Bar */}
      <div
        className="rt-card"
        style={{
          padding: '0.9rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#FFFFFF',
          borderLeft: '4px solid #0F172A',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              backgroundColor: '#F1F5F9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#0F172A',
            }}
          >
            <Share2 size={16} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0F172A' }}>
              Member B AI Agent Interface
            </div>
            <div style={{ fontSize: '0.725rem', color: '#64748B' }}>
              Bound via opaque key <code className="mono" style={{ color: '#0F172A', fontWeight: 600 }}>{caseDetail.case_id}</code>. Decisions and SAR narratives written by Member B.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {caseDetail.decisions && caseDetail.decisions.length > 0 ? (
            <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
              <strong>Last Decision:</strong>{' '}
              <span className="rt-badge rt-badge-emerald">
                {caseDetail.decisions[caseDetail.decisions.length - 1].decision}
              </span>{' '}
              by {caseDetail.decisions[caseDetail.decisions.length - 1].actor}
            </div>
          ) : (
            <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.7rem' }}>
              Pending Analyst Decision
            </span>
          )}
        </div>
      </div>

      {/* Tab Controls */}
      <div
        style={{
          display: 'flex',
          gap: '0.4rem',
          borderBottom: '1px solid #E2E8F0',
          paddingBottom: '0.5rem',
        }}
      >
        <button
          onClick={() => setActiveTab('graph')}
          className={`rt-button ${activeTab === 'graph' ? 'rt-button-primary' : ''}`}
          style={{ fontSize: '0.775rem', gap: '6px' }}
        >
          <Network size={14} />
          <span>Evidence Graph</span>
        </button>
        <button
          onClick={() => setActiveTab('transactions')}
          className={`rt-button ${activeTab === 'transactions' ? 'rt-button-primary' : ''}`}
          style={{ fontSize: '0.775rem', gap: '6px' }}
        >
          <FileText size={14} />
          <span>Transactions ({caseDetail.transactions?.length || 0})</span>
        </button>
        <button
          onClick={() => setActiveTab('hits')}
          className={`rt-button ${activeTab === 'hits' ? 'rt-button-primary' : ''}`}
          style={{ fontSize: '0.775rem', gap: '6px' }}
        >
          <Layers size={14} />
          <span>Detector Hits ({caseDetail.hits?.length || 0})</span>
        </button>
        <button
          onClick={() => setActiveTab('scoring')}
          className={`rt-button ${activeTab === 'scoring' ? 'rt-button-primary' : ''}`}
          style={{ fontSize: '0.775rem', gap: '6px' }}
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

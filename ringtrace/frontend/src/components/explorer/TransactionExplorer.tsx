import React, { useEffect, useState, useRef } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import {
  Compass,
  Search,
  ArrowLeft,
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCw,
  AlertCircle,
  Network
} from 'lucide-react';
import type { AccountDetailsResponse } from '../../types';
import { ringtraceApi } from '../../services/api';

interface TransactionExplorerProps {
  initialAccountId?: string | null;
  onBackToOverview: () => void;
}

const SAMPLE_ACCOUNTS = ['ACC_00001', 'ACC_00125', 'ACC_00378', 'ACC_01191', 'ACC_01507', 'ACC_00266'];

export const TransactionExplorer: React.FC<TransactionExplorerProps> = ({
  initialAccountId,
  onBackToOverview,
}) => {
  const [accountId, setAccountId] = useState(initialAccountId || 'ACC_00001');
  const [searchInput, setSearchInput] = useState(accountId);
  const [data, setData] = useState<AccountDetailsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cyContainerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  const fetchAccount = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await ringtraceApi.getAccountDetails(id.trim());
      setData(res);
      setAccountId(id.trim());
      setSearchInput(id.trim());
    } catch (err: any) {
      setError(err?.message || `Failed to fetch account ${id}`);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialAccountId) {
      fetchAccount(initialAccountId);
    } else {
      fetchAccount('ACC_00001');
    }
  }, [initialAccountId]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      fetchAccount(searchInput.trim());
    }
  };

  // Render centered local 1-hop subgraph in Cytoscape
  useEffect(() => {
    if (!cyContainerRef.current || !data) return;

    if (cyRef.current) {
      cyRef.current.destroy();
    }

    const currentId = data.account.id;
    const nodesMap = new Map<string, any>();

    // Center Node
    nodesMap.set(currentId, {
      data: {
        id: currentId,
        label: currentId,
        type: data.account.type,
        isCenter: true,
      },
    });

    const edges: any[] = [];

    // Outgoing edges
    data.outgoing.forEach((tx) => {
      if (!nodesMap.has(tx.dst)) {
        nodesMap.set(tx.dst, {
          data: { id: tx.dst, label: tx.dst, type: 'personal', isCenter: false },
        });
      }
      edges.push({
        data: {
          id: tx.tx_id,
          source: currentId,
          target: tx.dst,
          amount: tx.amount,
          tx_type: tx.tx_type,
        },
      });
    });

    // Incoming edges
    data.incoming.forEach((tx) => {
      if (!nodesMap.has(tx.src)) {
        nodesMap.set(tx.src, {
          data: { id: tx.src, label: tx.src, type: 'personal', isCenter: false },
        });
      }
      edges.push({
        data: {
          id: tx.tx_id,
          source: tx.src,
          target: currentId,
          amount: tx.amount,
          tx_type: tx.tx_type,
        },
      });
    });

    const cy = cytoscape({
      container: cyContainerRef.current,
      elements: [...Array.from(nodesMap.values()), ...edges],
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'color': '#cbd5e1',
            'font-size': '10px',
            'font-family': 'ui-monospace, monospace',
            'text-valign': 'bottom',
            'text-margin-y': 4,
            'background-color': '#475569',
            'border-width': 1.5,
            'border-color': '#334155',
            'width': 24,
            'height': 24,
          },
        },
        {
          selector: 'node[?isCenter]',
          style: {
            'background-color': '#2563eb',
            'border-color': '#38bdf8',
            'border-width': 3,
            'width': 36,
            'height': 36,
            'color': '#ffffff',
            'font-weight': 'bold',
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': '#334155',
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#475569',
            'arrow-scale': 0.8,
            'opacity': 0.85,
          },
        },
      ],
      layout: {
        name: 'concentric',
        concentric: (node: any) => (node.data('isCenter') ? 2 : 1),
        levelWidth: () => 1,
        padding: 25,
      },
    });

    cy.on('tap', 'node', (evt) => {
      const clickedId = evt.target.data('id');
      if (clickedId !== currentId) {
        fetchAccount(clickedId);
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [data]);

  const formatAmount = (amt: number) => {
    return '₹' + amt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatTime = (epochSeconds: number) => {
    return new Date(epochSeconds * 1000).toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Top Header & Search Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button onClick={onBackToOverview} className="rt-button" title="Back to Overview">
            <ArrowLeft size={14} />
            <span>Overview</span>
          </button>
          <div>
            <h2 style={{ fontSize: '1.25rem' }}>Transaction Explorer</h2>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Deep-dive account neighborhood & transaction tracing in <span className="mono">txn</span> graph
            </div>
          </div>
        </div>

        {/* Search input form */}
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '0.5rem', width: '340px' }}>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search account (e.g. ACC_00125)..."
            style={{
              flex: 1,
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '0.45rem 0.75rem',
              color: 'var(--text-primary)',
              fontSize: '0.825rem',
              outline: 'none'
            }}
          />
          <button type="submit" disabled={loading} className="rt-button rt-button-primary">
            <Search size={14} />
            <span>Inspect</span>
          </button>
        </form>
      </div>

      {/* Quick Jump Sample Accounts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.75rem' }}>
        <span style={{ color: 'var(--text-muted)' }}>Sample Accounts:</span>
        {SAMPLE_ACCOUNTS.map((acc) => (
          <button
            key={acc}
            onClick={() => fetchAccount(acc)}
            className="mono"
            style={{
              background: accountId === acc ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-card)',
              border: `1px solid ${accountId === acc ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
              color: accountId === acc ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              borderRadius: '4px',
              padding: '0.2rem 0.5rem',
              cursor: 'pointer',
              fontSize: '0.75rem'
            }}
          >
            {acc}
          </button>
        ))}
      </div>

      {error && (
        <div style={{
          padding: '1rem',
          borderRadius: '8px',
          backgroundColor: 'var(--accent-rose-subtle)',
          border: '1px solid rgba(244, 63, 94, 0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          color: 'var(--accent-rose)',
          fontSize: '0.85rem'
        }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading && !data && (
        <div className="rt-card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <RefreshCw size={24} className="spin" style={{ display: 'inline-block', marginBottom: '0.75rem' }} />
          <div>Retrieving account topology from FalkorDB...</div>
        </div>
      )}

      {data && (
        <>
          {/* Account Profile Card */}
          <div className="rt-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '8px',
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-cyan)'
              }}>
                <Compass size={24} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <h3 className="mono" style={{ fontSize: '1.25rem', color: 'var(--accent-cyan)' }}>
                    {data.account.id}
                  </h3>
                  <span className={`rt-badge badge-${data.account.type}`}>
                    {data.account.type}
                  </span>
                  <span className="rt-badge badge-personal">
                    Community: #{data.account.community}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Account Created: {data.account.created}
                </div>
              </div>
            </div>

            {/* Inflow / Outflow Sample Summary */}
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Outgoing ({data.out_count})
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-rose)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatAmount(data.total_sent_sample)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Incoming ({data.in_count})
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-emerald)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatAmount(data.total_received_sample)}
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Neighborhood Topology */}
          <div className="rt-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Network size={16} color="var(--accent-cyan)" />
                <h4 style={{ fontSize: '0.9rem' }}>Local 1-Hop Transfer Network</h4>
              </div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                Click any neighboring node to navigate & inspect
              </div>
            </div>
            <div ref={cyContainerRef} style={{ width: '100%', height: '320px', background: '#070b12', borderRadius: '6px' }} />
          </div>

          {/* Inflow & Outflow Transfers Table Split */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1.25rem' }}>
            {/* Outgoing Transfers */}
            <div className="rt-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <ArrowUpRight size={16} color="var(--accent-rose)" />
                <h4 style={{ fontSize: '0.875rem' }}>Outgoing Transfers ({data.out_count})</h4>
              </div>
              <div className="rt-table-container">
                <table className="rt-table">
                  <thead>
                    <tr>
                      <th>Recipient</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Channel</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.outgoing.length === 0 ? (
                      <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>No outgoing transfers</td></tr>
                    ) : (
                      data.outgoing.map((t) => (
                        <tr key={t.tx_id}>
                          <td>
                            <button
                              onClick={() => fetchAccount(t.dst)}
                              className="mono"
                              style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', cursor: 'pointer', padding: 0 }}
                            >
                              {t.dst}
                            </button>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatAmount(t.amount)}</td>
                          <td><span className="rt-badge" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>{t.tx_type}</span></td>
                          <td style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>{formatTime(t.ts).substring(0, 10)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Incoming Transfers */}
            <div className="rt-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <ArrowDownLeft size={16} color="var(--accent-emerald)" />
                <h4 style={{ fontSize: '0.875rem' }}>Incoming Transfers ({data.in_count})</h4>
              </div>
              <div className="rt-table-container">
                <table className="rt-table">
                  <thead>
                    <tr>
                      <th>Sender</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Channel</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.incoming.length === 0 ? (
                      <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>No incoming transfers</td></tr>
                    ) : (
                      data.incoming.map((t) => (
                        <tr key={t.tx_id}>
                          <td>
                            <button
                              onClick={() => fetchAccount(t.src)}
                              className="mono"
                              style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', cursor: 'pointer', padding: 0 }}
                            >
                              {t.src}
                            </button>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatAmount(t.amount)}</td>
                          <td><span className="rt-badge" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>{t.tx_type}</span></td>
                          <td style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>{formatTime(t.ts).substring(0, 10)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

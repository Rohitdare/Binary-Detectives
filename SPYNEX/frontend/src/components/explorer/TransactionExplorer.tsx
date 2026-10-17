import React, { useEffect, useState, useRef, useCallback } from 'react';
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

  const fetchAccount = useCallback(async (id: string) => {
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
  }, []);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const targetId = initialAccountId || 'ACC_00001';
      setLoading(true);
      setError(null);
      try {
        const res = await ringtraceApi.getAccountDetails(targetId.trim());
        if (isMounted) {
          setData(res);
          setAccountId(targetId.trim());
          setSearchInput(targetId.trim());
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || `Failed to fetch account ${targetId}`);
          setData(null);
          setLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
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
            'color': '#E2E8F0',
            'font-size': '10px',
            'font-family': 'ui-monospace, monospace',
            'text-valign': 'bottom',
            'text-margin-y': 4,
            'background-color': '#475569',
            'border-width': 1.5,
            'border-color': '#1E293B',
            'width': 22,
            'height': 22,
          },
        },
        {
          selector: 'node[?isCenter]',
          style: {
            'background-color': '#6D4AFF',
            'border-color': '#FFFFFF',
            'border-width': 2.5,
            'width': 34,
            'height': 34,
            'color': '#FFFFFF',
            'font-weight': 700,
            'font-size': '11px',
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': 'rgba(148, 163, 184, 0.45)',
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': 'rgba(148, 163, 184, 0.65)',
            'arrow-scale': 0.8,
            'opacity': 0.75,
          },
        },
      ],
      layout: {
        name: 'concentric',
        concentric: (node: any) => (node.data('isCenter') ? 2 : 1),
        levelWidth: () => 1,
        padding: 30,
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
  }, [data, fetchAccount]);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <button onClick={onBackToOverview} className="rt-button" title="Back to Overview">
            <ArrowLeft size={14} />
            <span>Overview</span>
          </button>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Transaction Explorer
            </h1>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Account counterparty neighborhood and direct transfer ledger
            </div>
          </div>
        </div>

        {/* Search input form */}
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '0.5rem', width: '360px' }}>
          <div className="rt-search-box" style={{ flex: 1 }}>
            <Search size={14} />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search account ID (e.g. ACC_00125)..."
              className="rt-input mono"
              style={{
                height: '36px',
                fontSize: '0.8rem',
              }}
            />
          </div>
          <button type="submit" disabled={loading} className="rt-button rt-button-primary" style={{ padding: '0.45rem 0.95rem', height: '36px' }}>
            <span>Inspect</span>
          </button>
        </form>
      </div>

      {/* Quick Jump Sample Accounts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', fontSize: '0.75rem' }}>
        <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Sample Accounts:</span>
        {SAMPLE_ACCOUNTS.map((acc) => {
          const isSelected = accountId === acc;
          return (
            <button
              key={acc}
              type="button"
              onClick={() => fetchAccount(acc)}
              className="mono"
              style={{
                background: isSelected ? 'var(--brand-purple-subtle)' : '#FFFFFF',
                border: `1px solid ${isSelected ? 'var(--brand-purple-border)' : 'var(--border-subtle)'}`,
                color: isSelected ? 'var(--brand-purple)' : 'var(--text-secondary)',
                borderRadius: '6px',
                padding: '0.2rem 0.55rem',
                cursor: 'pointer',
                fontSize: '0.725rem',
                fontWeight: 600,
                transition: 'all 0.15s ease'
              }}
            >
              {acc}
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{
          padding: '0.85rem 1.25rem',
          borderRadius: '8px',
          backgroundColor: 'var(--accent-red-subtle)',
          border: '1px solid var(--accent-red-border)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          color: 'var(--accent-red)',
          fontSize: '0.85rem'
        }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading && !data && (
        <div className="rt-card" style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <RefreshCw size={24} className="spin" style={{ display: 'inline-block', marginBottom: '0.75rem', color: 'var(--brand-purple)' }} />
          <div>Retrieving account topology...</div>
        </div>
      )}

      {data && (
        <>
          {/* Account Profile Card */}
          <div
            className="rt-card"
            style={{
              padding: '1rem 1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--surface-secondary)',
                  border: '1px solid var(--border-accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--brand-purple)',
                  flexShrink: 0,
                }}
              >
                <Compass size={22} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <h3 className="mono" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                    {data.account.id}
                  </h3>
                  <span className={`rt-badge badge-${data.account.type}`} style={{ fontSize: '0.675rem' }}>
                    {data.account.type}
                  </span>
                  <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.675rem' }}>
                    Community #{data.account.community}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  Account Created: {data.account.created}
                </div>
              </div>
            </div>

            {/* Inflow / Outflow Summary Metrics */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  Outgoing Sent ({data.out_count})
                </span>
                <span
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    color: '#DC2626',
                    fontFamily: 'JetBrains Mono, monospace',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {formatAmount(data.total_sent_sample)}
                </span>
              </div>

              <div style={{ width: '1px', height: '32px', backgroundColor: 'var(--border-subtle)' }} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  Incoming Received ({data.in_count})
                </span>
                <span
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    color: '#059669',
                    fontFamily: 'JetBrains Mono, monospace',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {formatAmount(data.total_received_sample)}
                </span>
              </div>
            </div>
          </div>

          {/* Direct Transfer Network */}
          <div
            className="rt-card"
            style={{
              padding: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '0.85rem 1.25rem',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.5rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <Network size={16} style={{ color: 'var(--brand-purple)' }} />
                <div>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                    Direct Counterparty Network
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.725rem', color: 'var(--text-secondary)' }}>
                    1-hop transaction topology
                  </p>
                </div>
              </div>
            </div>

            <div
              ref={cyContainerRef}
              style={{
                width: '100%',
                height: '380px',
                background: '#0B121E',
              }}
            />
          </div>

          {/* Inflow & Outflow Transfers Table Split */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.25rem' }}>
            {/* Outgoing Transfers */}
            <div className="rt-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  padding: '0.85rem 1.25rem',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ArrowUpRight size={15} style={{ color: 'var(--accent-red)' }} />
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Outgoing Transfers
                  </span>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      padding: '0.1rem 0.45rem',
                      borderRadius: '9999px',
                      backgroundColor: 'var(--bg-app)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {data.out_count}
                  </span>
                </div>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {formatAmount(data.total_sent_sample)}
                </span>
              </div>

              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <table className="rt-table" style={{ margin: 0 }}>
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
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                          No outgoing transfers
                        </td>
                      </tr>
                    ) : (
                      data.outgoing.map((t) => (
                        <tr key={t.tx_id}>
                          <td>
                            <button
                              type="button"
                              onClick={() => fetchAccount(t.dst)}
                              className="mono"
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                padding: '0.1rem 0',
                                fontWeight: 600,
                                fontSize: '0.8rem',
                                transition: 'color 0.15s ease',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--brand-purple)')}
                              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                              title={`Inspect ${t.dst}`}
                            >
                              {t.dst}
                            </button>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'JetBrains Mono, monospace' }}>
                            {formatAmount(t.amount)}
                          </td>
                          <td>
                            <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>
                              {t.tx_type}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', fontFamily: 'JetBrains Mono, monospace' }}>
                            {formatTime(t.ts).substring(0, 10)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Incoming Transfers */}
            <div className="rt-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  padding: '0.85rem 1.25rem',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ArrowDownLeft size={15} style={{ color: 'var(--accent-green)' }} />
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Incoming Transfers
                  </span>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      padding: '0.1rem 0.45rem',
                      borderRadius: '9999px',
                      backgroundColor: 'var(--bg-app)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {data.in_count}
                  </span>
                </div>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {formatAmount(data.total_received_sample)}
                </span>
              </div>

              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <table className="rt-table" style={{ margin: 0 }}>
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
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                          No incoming transfers
                        </td>
                      </tr>
                    ) : (
                      data.incoming.map((t) => (
                        <tr key={t.tx_id}>
                          <td>
                            <button
                              type="button"
                              onClick={() => fetchAccount(t.src)}
                              className="mono"
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                padding: '0.1rem 0',
                                fontWeight: 600,
                                fontSize: '0.8rem',
                                transition: 'color 0.15s ease',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--brand-purple)')}
                              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                              title={`Inspect ${t.src}`}
                            >
                              {t.src}
                            </button>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'JetBrains Mono, monospace' }}>
                            {formatAmount(t.amount)}
                          </td>
                          <td>
                            <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>
                              {t.tx_type}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', fontFamily: 'JetBrains Mono, monospace' }}>
                            {formatTime(t.ts).substring(0, 10)}
                          </td>
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

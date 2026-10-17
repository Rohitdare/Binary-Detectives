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
            'background-color': '#38A189',
            'border-color': '#FFFFFF',
            'border-width': 3,
            'width': 36,
            'height': 36,
            'color': '#FDE047',
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Header & Search Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <button onClick={onBackToOverview} className="rt-button" title="Back to Overview">
            <ArrowLeft size={14} />
            <span>Overview</span>
          </button>
          <div>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              Transaction Explorer
            </h1>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Deep-dive account neighborhood & transaction tracing in FalkorDB <span className="mono" style={{ color: 'var(--brand-forest)' }}>txn</span> graph
            </div>
          </div>
        </div>

        {/* Search input form */}
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '0.5rem', width: '360px' }}>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search account (e.g. ACC_00125)..."
            style={{
              flex: 1,
              background: 'var(--surface-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '0.5rem 0.85rem',
              color: 'var(--text-primary)',
              fontSize: '0.825rem',
              outline: 'none',
              fontFamily: 'var(--font-sans)'
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
        <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Quick Forensics Samples:</span>
        {SAMPLE_ACCOUNTS.map((acc) => (
          <button
            key={acc}
            onClick={() => fetchAccount(acc)}
            className="mono"
            style={{
              background: accountId === acc ? 'var(--brand-mint-subtle)' : 'var(--surface-primary)',
              border: `1px solid ${accountId === acc ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
              color: accountId === acc ? 'var(--brand-forest)' : 'var(--text-secondary)',
              borderRadius: '6px',
              padding: '0.25rem 0.6rem',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 600,
              transition: 'all 0.15s ease'
            }}
          >
            {acc}
          </button>
        ))}
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
          <RefreshCw size={24} className="spin" style={{ display: 'inline-block', marginBottom: '0.75rem', color: 'var(--brand-teal)' }} />
          <div>Retrieving account topology from FalkorDB...</div>
        </div>
      )}

      {data && (
        <>
          {/* Account Profile Card */}
          <div className="rt-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.5rem', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '10px',
                backgroundColor: '#F1F5F9',
                border: '1px solid #E2E8F0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#0F172A'
              }}>
                <Compass size={24} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <h3 className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                    {data.account.id}
                  </h3>
                  <span className={`rt-badge badge-${data.account.type}`}>
                    {data.account.type}
                  </span>
                  <span className="rt-badge rt-badge-gray">
                    Community #{data.account.community}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '0.25rem' }}>
                  Account Created: {data.account.created}
                </div>
              </div>
            </div>

            {/* Inflow / Outflow Sample Summary */}
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
              <div style={{ padding: '0.5rem 1rem', borderRadius: '8px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                <div style={{ fontSize: '0.68rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  Outgoing Sent ({data.out_count})
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#DC2626', fontFamily: 'JetBrains Mono, monospace' }}>
                  {formatAmount(data.total_sent_sample)}
                </div>
              </div>
              <div style={{ padding: '0.5rem 1rem', borderRadius: '8px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                <div style={{ fontSize: '0.68rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  Incoming Received ({data.in_count})
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#059669', fontFamily: 'JetBrains Mono, monospace' }}>
                  {formatAmount(data.total_received_sample)}
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Neighborhood Topology */}
          <div className="rt-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '6px', backgroundColor: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF' }}>
                  <Network size={16} />
                </div>
                <div>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: '#0F172A' }}>
                    Local 1-Hop Transfer Network
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.725rem', color: '#64748B' }}>
                    Topological star-burst schema of direct account counterparties
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.7rem', color: '#64748B', backgroundColor: '#F1F5F9', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid #E2E8F0', fontFamily: 'JetBrains Mono, monospace' }}>
                  Canvas: Vector Accelerated
                </span>
              </div>
            </div>

            {/* Hint Helper Strip */}
            <div style={{ padding: '0.35rem 0.75rem', borderRadius: '6px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.725rem', color: '#475569' }}>
              <span>Click any neighboring node to trace and re-center graph topology. Drag background to pan.</span>
            </div>

            <div
              ref={cyContainerRef}
              style={{
                width: '100%',
                height: '380px',
                background: '#0B121E',
                borderRadius: '8px',
                border: '1px solid #1E293B',
                boxShadow: 'inset 0 2px 10px rgba(0, 0, 0, 0.5)'
              }}
            />
          </div>

          {/* Inflow & Outflow Transfers Table Split */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1.25rem' }}>
            {/* Outgoing Transfers */}
            <div className="rt-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.85rem' }}>
                <ArrowUpRight size={16} color="var(--accent-red)" />
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Outgoing Transfers ({data.out_count})
                </h4>
              </div>
              <div className="rt-table-container" style={{ maxHeight: '300px', overflowY: 'auto' }}>
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
                      <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No outgoing transfers</td></tr>
                    ) : (
                      data.outgoing.map((t) => (
                        <tr key={t.tx_id}>
                          <td>
                            <button
                              onClick={() => fetchAccount(t.dst)}
                              className="mono"
                              style={{ background: 'none', border: 'none', color: '#0F172A', cursor: 'pointer', padding: 0, fontWeight: 600, textDecoration: 'underline' }}
                            >
                              {t.dst}
                            </button>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatAmount(t.amount)}</td>
                          <td><span className="rt-badge rt-badge-gray" style={{ fontSize: '0.675rem' }}>{t.tx_type}</span></td>
                          <td style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{formatTime(t.ts).substring(0, 10)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Incoming Transfers */}
            <div className="rt-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.85rem' }}>
                <ArrowDownLeft size={16} color="var(--accent-green)" />
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Incoming Transfers ({data.in_count})
                </h4>
              </div>
              <div className="rt-table-container" style={{ maxHeight: '300px', overflowY: 'auto' }}>
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
                      <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No incoming transfers</td></tr>
                    ) : (
                      data.incoming.map((t) => (
                        <tr key={t.tx_id}>
                          <td>
                            <button
                              onClick={() => fetchAccount(t.src)}
                              className="mono"
                              style={{ background: 'none', border: 'none', color: '#0F172A', cursor: 'pointer', padding: 0, fontWeight: 600, textDecoration: 'underline' }}
                            >
                              {t.src}
                            </button>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatAmount(t.amount)}</td>
                          <td><span className="rt-badge rt-badge-gray" style={{ fontSize: '0.675rem' }}>{t.tx_type}</span></td>
                          <td style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{formatTime(t.ts).substring(0, 10)}</td>
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

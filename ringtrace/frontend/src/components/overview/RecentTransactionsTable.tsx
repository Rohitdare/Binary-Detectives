import React from 'react';
import { ArrowRight, RefreshCw, Layers } from 'lucide-react';
import type { TransactionRecord } from '../../types';

interface RecentTransactionsTableProps {
  transactions: TransactionRecord[];
  loading: boolean;
  onSelectAccount: (accountId: string) => void;
  onRefresh: () => void;
}

export const RecentTransactionsTable: React.FC<RecentTransactionsTableProps> = ({
  transactions,
  loading,
  onSelectAccount,
  onRefresh,
}) => {
  const formatTime = (epochSeconds: number) => {
    const d = new Date(epochSeconds * 1000);
    return d.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  };

  const formatAmount = (amt: number) => {
    return '₹' + amt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="rt-card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ padding: '0.35rem', borderRadius: '6px', background: 'var(--accent-purple-subtle)', color: 'var(--accent-purple)' }}>
            <Layers size={16} />
          </div>
          <div>
            <h3 style={{ fontSize: '0.95rem' }}>Recent Ledger Transactions</h3>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
              Chronological flow from FalkorDB <span className="mono">txn</span> graph
            </div>
          </div>
        </div>

        <button onClick={onRefresh} disabled={loading} className="rt-button rt-button-sm" title="Refresh transactions">
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="rt-table-container" style={{ flex: 1, minHeight: '300px' }}>
        <table className="rt-table">
          <thead>
            <tr>
              <th style={{ width: '130px' }}>Transaction ID</th>
              <th>Sender</th>
              <th style={{ width: '40px' }}></th>
              <th>Receiver</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Channel</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {loading && transactions.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  <RefreshCw size={18} className="spin" style={{ display: 'inline-block', marginBottom: '0.5rem' }} />
                  <div>Loading transactions from FalkorDB...</div>
                </td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  No transactions found in database.
                </td>
              </tr>
            ) : (
              transactions.map((tx) => (
                <tr key={tx.tx_id}>
                  <td className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.775rem' }}>
                    {tx.tx_id}
                  </td>
                  <td>
                    <button
                      onClick={() => onSelectAccount(tx.src)}
                      className="mono"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-cyan)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: '0.8rem'
                      }}
                      title="Inspect sender account"
                    >
                      {tx.src}
                    </button>
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    <ArrowRight size={13} />
                  </td>
                  <td>
                    <button
                      onClick={() => onSelectAccount(tx.dst)}
                      className="mono"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-cyan)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: '0.8rem'
                      }}
                      title="Inspect receiver account"
                    >
                      {tx.dst}
                    </button>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatAmount(tx.amount)}
                  </td>
                  <td>
                    <span className="rt-badge" style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' }}>
                      {tx.tx_type}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                    {formatTime(tx.ts)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

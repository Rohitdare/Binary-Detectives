import React, { useState, useMemo } from 'react';
import { ArrowRight, Search, Check, Copy } from 'lucide-react';
import type { CaseTransaction } from '../../types';

interface CaseTransactionTableProps {
  transactions: CaseTransaction[];
  selectedTxId: string | null;
  onSelectTx: (txId: string | null) => void;
  onSelectAccount: (accountId: string) => void;
}

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export const CaseTransactionTable: React.FC<CaseTransactionTableProps> = ({
  transactions,
  selectedTxId,
  onSelectTx,
  onSelectAccount,
}) => {
  const [search, setSearch] = useState('');
  const [copiedTxId, setCopiedTxId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return transactions;
    const q = search.toLowerCase();
    return transactions.filter(
      (tx) =>
        tx.tx_id.toLowerCase().includes(q) ||
        tx.src.toLowerCase().includes(q) ||
        tx.dst.toLowerCase().includes(q)
    );
  }, [transactions, search]);

  const handleCopy = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(id);
    setCopiedTxId(id);
    setTimeout(() => setCopiedTxId(null), 1500);
  };

  const formatTimestamp = (ts: string | number) => {
    if (typeof ts === 'string') return ts;
    const d = new Date(ts * 1000);
    return isNaN(d.getTime()) ? String(ts) : d.toISOString().replace('T', ' ').substring(0, 19);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Supporting Transactions ({filtered.length} of {transactions.length})
        </div>
        <div style={{ position: 'relative', width: '200px' }}>
          <Search size={12} style={{ position: 'absolute', left: '8px', top: '8px', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search tx / account..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rt-input"
            style={{ paddingLeft: '26px', fontSize: '0.725rem', height: '28px', width: '100%' }}
          />
        </div>
      </div>

      <div
        style={{
          maxHeight: '260px',
          overflowY: 'auto',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          backgroundColor: 'var(--surface-primary)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--surface-secondary)', borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>TX ID</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Sender</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Recipient</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>Amount</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Timestamp</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Type</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No transactions found matching criteria.
                </td>
              </tr>
            ) : (
              filtered.map((tx) => {
                const isSelected = selectedTxId === tx.tx_id;
                return (
                  <tr
                    key={tx.tx_id}
                    onClick={() => onSelectTx(isSelected ? null : tx.tx_id)}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      backgroundColor: isSelected ? 'var(--brand-mint-subtle)' : 'transparent',
                      transition: 'background-color 0.1s',
                    }}
                  >
                    <td style={{ padding: '0.45rem 0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span className="mono" style={{ fontWeight: 600, color: isSelected ? 'var(--brand-forest)' : 'var(--text-primary)' }}>
                          {tx.tx_id}
                        </span>
                        <button
                          onClick={(e) => handleCopy(e, tx.tx_id)}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px' }}
                          title="Copy TX ID"
                        >
                          {copiedTxId === tx.tx_id ? <Check size={10} color="var(--brand-teal)" /> : <Copy size={10} />}
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '0.45rem 0.75rem' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectAccount(tx.src);
                        }}
                        className="mono"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--accent-blue)',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          fontSize: '0.75rem',
                        }}
                      >
                        {tx.src}
                      </button>
                    </td>
                    <td style={{ padding: '0.45rem 0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <ArrowRight size={10} color="var(--text-muted)" />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectAccount(tx.dst);
                          }}
                          className="mono"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--accent-blue)',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            fontSize: '0.75rem',
                          }}
                        >
                          {tx.dst}
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '0.45rem 0.75rem', textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {currency.format(tx.amount)}
                    </td>
                    <td style={{ padding: '0.45rem 0.75rem', color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
                      {formatTimestamp(tx.ts)}
                    </td>
                    <td style={{ padding: '0.45rem 0.75rem' }}>
                      <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.65rem' }}>
                        {tx.tx_type || 'UPI'}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

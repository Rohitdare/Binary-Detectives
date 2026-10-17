import React, { useState, useMemo } from 'react';
import { Search, Copy, Check, Filter, X } from 'lucide-react';
import type { DetectorPattern } from '../../types';
import type { WorkbenchCandidate } from './types';
import {
  getCandidateHumanTitle,
  getCandidateHumanSubtitle,
} from './candidateUtils';

interface CandidateListProps {
  candidates: WorkbenchCandidate[];
  selectedCandidate: WorkbenchCandidate | null;
  onSelectCandidate: (candidate: WorkbenchCandidate) => void;
  pattern: DetectorPattern;
}

export const CandidateList: React.FC<CandidateListProps> = ({
  candidates,
  selectedCandidate,
  onSelectCandidate,
  pattern: _pattern,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSuspiciousOnly, setFilterSuspiciousOnly] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const suspiciousCount = useMemo(
    () => candidates.filter((c) => c.suspicious).length,
    [candidates]
  );

  const filteredCandidates = useMemo(() => {
    return candidates.filter((c) => {
      if (filterSuspiciousOnly && !c.suspicious) return false;
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        c.id.toLowerCase().includes(term) ||
        c.accounts.some((acc) => acc.toLowerCase().includes(term)) ||
        c.transactions.some((tx) => tx.tx_id.toLowerCase().includes(term))
      );
    });
  }, [candidates, searchTerm, filterSuspiciousOnly]);

  const handleCopyId = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: '480px',
      }}
    >
      {/* Header and Filter Controls */}
      <div style={{ marginBottom: '0.75rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Candidates
            </span>
            <span
              className="rt-badge rt-badge-gray"
              style={{ fontSize: '0.675rem', fontVariantNumeric: 'tabular-nums' }}
            >
              {filteredCandidates.length}
              {filteredCandidates.length !== candidates.length ? ` / ${candidates.length}` : ''}
            </span>
          </div>

          {/* Suspicious Triage Toggle */}
          {suspiciousCount > 0 && (
            <button
              onClick={() => setFilterSuspiciousOnly((prev) => !prev)}
              className={`rt-button rt-button-sm ${filterSuspiciousOnly ? 'rt-button-primary' : ''}`}
              style={{
                fontSize: '0.7rem',
                padding: '0.2rem 0.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
              }}
              title="Show only candidates meeting suspicious heuristic criteria"
            >
              <Filter size={11} />
              <span>Flagged ({suspiciousCount})</span>
            </button>
          )}
        </div>

        {/* Search Input */}
        <div className="rt-search-box" style={{ width: '100%' }}>
          <Search size={13} />
          <input
            type="text"
            placeholder="Filter by account or candidate ID…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="rt-input"
            style={{
              width: '100%',
              height: '32px',
              paddingRight: searchTerm ? '2rem' : '0.75rem',
            }}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              style={{
                position: 'absolute',
                right: '0.55rem',
                background: 'transparent',
                border: 'none',
                color: '#94A3B8',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Candidate Rows Container */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.45rem',
          overflowY: 'auto',
          maxHeight: 'calc(100vh - 280px)',
          paddingRight: '0.25rem',
        }}
      >
        {filteredCandidates.length === 0 ? (
          <div
            style={{
              padding: '2.5rem 1rem',
              textAlign: 'center',
              backgroundColor: 'var(--surface-secondary)',
              borderRadius: '8px',
              border: '1px dashed var(--border-subtle)',
              color: 'var(--text-muted)',
              fontSize: '0.78rem',
            }}
          >
            {searchTerm || filterSuspiciousOnly
              ? 'No candidates match the active search filter.'
              : 'No candidates found for this detector.'}
          </div>
        ) : (
          filteredCandidates.map((c) => {
            const isSelected = selectedCandidate?.id === c.id;
            const title = getCandidateHumanTitle(c);
            const subtitle = getCandidateHumanSubtitle(c);

            return (
              <div
                key={c.id}
                onClick={() => onSelectCandidate(c)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelectCandidate(c);
                }}
                style={{
                  padding: '0.65rem 0.8rem',
                  borderRadius: '8px',
                  backgroundColor: isSelected ? '#F8F7FF' : '#FFFFFF',
                  border: `1px solid ${isSelected ? '#C4B5FD' : '#E2E8F0'}`,
                  borderLeft: isSelected ? '3.5px solid #6D4AFF' : '3.5px solid transparent',
                  boxShadow: isSelected
                    ? '0 2px 6px rgba(109, 74, 255, 0.08)'
                    : '0 1px 2px rgba(0, 0, 0, 0.02)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  textAlign: 'left',
                }}
              >
                {/* Title and Status Badge */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: isSelected ? '#4C1D95' : '#0F172A',
                      lineHeight: 1.3,
                    }}
                  >
                    {title}
                  </span>
                  <span
                    className={`rt-badge ${c.suspicious ? 'rt-badge-amber' : 'rt-badge-gray'}`}
                    style={{
                      fontSize: '0.625rem',
                      padding: '0.1rem 0.4rem',
                      flexShrink: 0,
                    }}
                  >
                    {c.suspicious ? 'Flagged' : 'Candidate'}
                  </span>
                </div>

                {/* Subtitle details (Amount, duration, retention) */}
                <div
                  style={{
                    fontSize: '0.725rem',
                    color: isSelected ? '#334155' : 'var(--text-secondary)',
                    marginTop: '0.2rem',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {subtitle}
                </div>

                {/* Footer with accounts/transfers count and copyable ID (seamless, no dividing hairline) */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: '0.35rem',
                    fontSize: '0.68rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span>
                    {c.accounts.length} accounts · {c.transactions.length} transfers
                  </span>

                  {/* Copyable ID button */}
                  <button
                    onClick={(e) => handleCopyId(e, c.id)}
                    className="rt-button rt-button-sm"
                    style={{
                      padding: '0.1rem 0.3rem',
                      fontSize: '0.65rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      color: isSelected ? '#6D4AFF' : 'var(--text-muted)',
                      border: 'none',
                      backgroundColor: isSelected ? '#EDE9FE' : '#F1F5F9',
                      borderRadius: '4px',
                    }}
                    title="Copy canonical candidate ID"
                  >
                    <span className="mono" style={{ maxWidth: '105px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.id}
                    </span>
                    {copiedId === c.id ? (
                      <Check size={10} color="#10B981" />
                    ) : (
                      <Copy size={10} />
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

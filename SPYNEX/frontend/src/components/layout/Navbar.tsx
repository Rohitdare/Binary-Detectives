import React, { useState, useEffect, useRef } from 'react';
import { Search, RefreshCw, User, Briefcase, FileText } from 'lucide-react';
import type { HealthStatus, SearchResultAccount } from '../../types';
import { ringtraceApi } from '../../services/api';

interface NavbarProps {
  health?: HealthStatus | null;
  onRefreshHealth?: () => void;
  onSelectAccount: (accountId: string) => void;
  onSelectCase?: (caseId: string) => void;
}

interface CaseCandidate {
  id: string;
  score?: number;
  status?: string;
  patterns?: string[];
}

export const Navbar: React.FC<NavbarProps> = ({
  onSelectAccount,
  onSelectCase,
}) => {
  const [query, setQuery] = useState('');
  const [accountResults, setAccountResults] = useState<SearchResultAccount[]>([]);
  const [caseResults, setCaseResults] = useState<CaseCandidate[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setAccountResults([]);
      setCaseResults([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const uppercaseTerm = trimmed.toUpperCase();

        // 1. Search accounts (via /api/search)
        const accountPromise = ringtraceApi.searchAccounts(trimmed, 6).catch(() => []);

        // 2. Search cases if the term matches or looks like case identifiers or pattern names
        const casePromise = ringtraceApi.getCases({ limit: 50 }).then((res) => {
          const items = res.items || [];
          return items
            .filter((c) =>
              c.case_id.toUpperCase().includes(uppercaseTerm) ||
              c.patterns.some((p) => p.toUpperCase().includes(uppercaseTerm))
            )
            .slice(0, 4)
            .map((c) => ({
              id: c.case_id,
              score: c.score,
              status: c.status,
              patterns: c.patterns,
            }));
        }).catch(() => []);

        const [accounts, matchedCases] = await Promise.all([accountPromise, casePromise]);

        setAccountResults(accounts);
        setCaseResults(matchedCases);
        setShowDropdown(accounts.length > 0 || matchedCases.length > 0);
      } catch {
        setAccountResults([]);
        setCaseResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  // Click outside to close search dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (!val.trim() || val.length < 2) {
      setAccountResults([]);
      setCaseResults([]);
      setShowDropdown(false);
    }
  };

  const handleSelectAccountItem = (accId: string) => {
    onSelectAccount(accId);
    setQuery('');
    setAccountResults([]);
    setCaseResults([]);
    setShowDropdown(false);
  };

  const handleSelectCaseItem = (caseId: string) => {
    if (onSelectCase) {
      onSelectCase(caseId);
    }
    setQuery('');
    setAccountResults([]);
    setCaseResults([]);
    setShowDropdown(false);
  };

  const hasAnyResults = accountResults.length > 0 || caseResults.length > 0;

  return (
    <header
      style={{
        height: '56px',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #E2E8F0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: '0 1.5rem',
        flexShrink: 0,
        position: 'relative',
        zIndex: 15,
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.02)',
      }}
    >
      {/* Functional Interactive Search Bar */}
      <div ref={searchRef} style={{ position: 'relative', width: '420px', maxWidth: '100%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.55rem',
            backgroundColor: isFocused ? '#FFFFFF' : '#F8FAFC',
            border: isFocused ? '1px solid var(--brand-purple, #6366F1)' : '1px solid #E2E8F0',
            borderRadius: '8px',
            padding: '0.45rem 0.8rem',
            color: 'var(--text-primary)',
            boxShadow: isFocused ? '0 0 0 3px rgba(99, 102, 241, 0.1)' : 'none',
            transition: 'all 0.18s ease',
          }}
        >
          {isSearching ? (
            <RefreshCw size={15} className="spin" color="#64748B" />
          ) : (
            <Search size={15} color={isFocused ? 'var(--brand-purple, #6366F1)' : '#94A3B8'} />
          )}
          <input
            type="text"
            placeholder="Search accounts, cases, patterns..."
            value={query}
            onChange={handleQueryChange}
            onFocus={() => {
              setIsFocused(true);
              if (hasAnyResults) setShowDropdown(true);
            }}
            onBlur={() => setIsFocused(false)}
            aria-label="Search accounts and cases"
            style={{
              border: 'none',
              background: 'transparent',
              outline: 'none',
              color: '#0F172A',
              fontSize: '0.825rem',
              width: '100%',
              fontFamily: 'var(--font-sans)',
            }}
          />
          {query.trim().length >= 2 && !isSearching && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setAccountResults([]);
                setCaseResults([]);
                setShowDropdown(false);
              }}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#94A3B8',
                cursor: 'pointer',
                fontSize: '0.75rem',
                padding: '0 0.2rem',
              }}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Dropdown Multi-Entity Search Results */}
        {showDropdown && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              backgroundColor: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '10px',
              boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.04)',
              overflow: 'hidden',
              zIndex: 50,
              maxHeight: '380px',
              overflowY: 'auto',
            }}
          >
            {/* Case Matches */}
            {caseResults.length > 0 && (
              <div>
                <div
                  style={{
                    padding: '0.45rem 0.85rem',
                    fontSize: '0.675rem',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    color: '#64748B',
                    backgroundColor: '#F8FAFC',
                    borderBottom: '1px solid #E2E8F0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <Briefcase size={12} /> Cases ({caseResults.length})
                </div>
                {caseResults.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => handleSelectCaseItem(c.id)}
                    style={{
                      padding: '0.55rem 0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      borderBottom: '1px solid #F1F5F9',
                      transition: 'background-color 0.12s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#FAF5FF')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                      <FileText size={14} color="#6366F1" />
                      <span style={{ fontWeight: 600, fontSize: '0.8rem', color: '#0F172A', fontFamily: 'var(--font-mono)' }}>
                        {c.id}
                      </span>
                      {c.patterns && c.patterns.length > 0 && (
                        <span
                          style={{
                            fontSize: '0.65rem',
                            padding: '0.1rem 0.45rem',
                            borderRadius: '9999px',
                            backgroundColor: '#EEF2FF',
                            color: '#4F46E5',
                            fontWeight: 600,
                          }}
                        >
                          {c.patterns.join(', ')}
                        </span>
                      )}
                    </div>
                    {typeof c.score === 'number' && (
                      <span
                        style={{
                          fontSize: '0.725rem',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                          color: c.score >= 70 ? '#DC2626' : c.score >= 40 ? '#D97706' : '#059669',
                        }}
                      >
                        Score {c.score}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Account Matches */}
            {accountResults.length > 0 && (
              <div>
                <div
                  style={{
                    padding: '0.45rem 0.85rem',
                    fontSize: '0.675rem',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    color: '#64748B',
                    backgroundColor: '#F8FAFC',
                    borderBottom: '1px solid #E2E8F0',
                    borderTop: caseResults.length > 0 ? '1px solid #E2E8F0' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <User size={12} /> Accounts ({accountResults.length})
                </div>
                {accountResults.map((acc) => (
                  <div
                    key={acc.id}
                    onClick={() => handleSelectAccountItem(acc.id)}
                    style={{
                      padding: '0.55rem 0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      borderBottom: '1px solid #F1F5F9',
                      transition: 'background-color 0.12s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#FAF5FF')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.8rem', color: '#0F172A', fontFamily: 'var(--font-mono)' }}>
                        {acc.id}
                      </span>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          padding: '0.1rem 0.45rem',
                          borderRadius: '9999px',
                          backgroundColor:
                            acc.type === 'merchant'
                              ? '#EFF6FF'
                              : acc.type === 'payroll'
                              ? '#ECFDF5'
                              : '#F1F5F9',
                          color:
                            acc.type === 'merchant'
                              ? '#0284C7'
                              : acc.type === 'payroll'
                              ? '#047857'
                              : '#475569',
                          fontWeight: 600,
                        }}
                      >
                        {acc.type}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.725rem', color: '#64748B', fontFamily: 'var(--font-mono)' }}>
                      community #{acc.community}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {!hasAnyResults && !isSearching && (
              <div style={{ padding: '1rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.78rem' }}>
                No accounts or cases matched &ldquo;{query}&rdquo;
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

export default Navbar;

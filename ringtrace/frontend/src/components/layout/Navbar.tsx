import React, { useState, useEffect, useRef } from 'react';
import { Search, RefreshCw, Database } from 'lucide-react';
import type { HealthStatus, SearchResultAccount } from '../../types';
import { ringtraceApi } from '../../services/api';

interface NavbarProps {
  health?: HealthStatus | null;
  onRefreshHealth?: () => void;
  onSelectAccount: (accountId: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ health, onRefreshHealth, onSelectAccount }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultAccount[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const isConnected = Boolean(health?.falkordb_connected);

  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const matches = await ringtraceApi.searchAccounts(query.trim(), 6);
        setResults(matches);
        setShowDropdown(true);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 250);

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
      setResults([]);
      setShowDropdown(false);
    }
  };

  const handleSelect = (accId: string) => {
    onSelectAccount(accId);
    setQuery('');
    setResults([]);
    setShowDropdown(false);
  };

  return (
    <header
      style={{
        height: '56px',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #E2E8F0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1.5rem',
        flexShrink: 0,
        position: 'relative',
        zIndex: 15,
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.02)',
      }}
    >
      {/* Minimal Aesthetic Search Bar */}
      <div ref={searchRef} style={{ position: 'relative', width: '380px', maxWidth: '100%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.55rem',
            backgroundColor: isFocused ? '#FFFFFF' : '#F8FAFC',
            border: isFocused ? '1px solid #6366F1' : '1px solid #E2E8F0',
            borderRadius: '8px',
            padding: '0.4rem 0.75rem',
            color: '#334155',
            boxShadow: isFocused ? '0 0 0 3px rgba(99, 102, 241, 0.08)' : 'none',
            transition: 'all 0.18s ease',
          }}
        >
          {isSearching ? (
            <RefreshCw size={14} className="spin" color="#64748B" />
          ) : (
            <Search size={14} color={isFocused ? '#6366F1' : '#94A3B8'} />
          )}
          <input
            type="text"
            placeholder="Search accounts, transactions, cases..."
            value={query}
            onChange={handleQueryChange}
            onFocus={() => {
              setIsFocused(true);
              if (results.length > 0) setShowDropdown(true);
            }}
            onBlur={() => setIsFocused(false)}
            style={{
              border: 'none',
              background: 'transparent',
              outline: 'none',
              color: '#0F172A',
              fontSize: '0.8rem',
              width: '100%',
              fontFamily: 'var(--font-sans)',
            }}
          />
        </div>

        {/* Dropdown Search Results */}
        {showDropdown && results.length > 0 && (
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
            }}
          >
            <div
              style={{
                padding: '0.4rem 0.75rem',
                fontSize: '0.65rem',
                textTransform: 'uppercase',
                fontWeight: 700,
                color: '#64748B',
                backgroundColor: '#F8FAFC',
                borderBottom: '1px solid #E2E8F0',
              }}
            >
              Account Candidates
            </div>
            {results.map((acc) => (
              <div
                key={acc.id}
                onClick={() => handleSelect(acc.id)}
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
      </div>

      {/* Minimal FalkorDB Status Icon on Right */}
      <button
        onClick={onRefreshHealth}
        title={
          isConnected
            ? `FalkorDB Online (${health?.graph || 'txn'}) — Click to verify`
            : 'FalkorDB Offline — Click to re-check connection'
        }
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '8px',
          backgroundColor: '#FFFFFF',
          border: '1px solid #E2E8F0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: isConnected ? '#475569' : '#DC2626',
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.02)',
          transition: 'all 0.15s ease',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = '#F8FAFC';
          e.currentTarget.style.borderColor = '#CBD5E1';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = '#FFFFFF';
          e.currentTarget.style.borderColor = '#E2E8F0';
        }}
      >
        <Database size={15} color={isConnected ? '#475569' : '#DC2626'} />
      </button>
    </header>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import { Search, RefreshCw, User, CheckCircle2, AlertCircle } from 'lucide-react';
import type { HealthStatus, SearchResultAccount } from '../../types';
import { ringtraceApi } from '../../services/api';

interface NavbarProps {
  health: HealthStatus | null;
  onRefreshHealth: () => void;
  onSelectAccount: (accountId: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ health, onRefreshHealth, onSelectAccount }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultAccount[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults([]);
      setShowDropdown(false);
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

  const handleSelect = (accId: string) => {
    onSelectAccount(accId);
    setQuery('');
    setShowDropdown(false);
  };

  return (
    <header style={{
      height: '60px',
      backgroundColor: 'var(--bg-card)',
      borderBottom: '1px solid var(--border-subtle)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 2rem',
      flexShrink: 0
    }}>
      {/* Search Input */}
      <div ref={searchRef} style={{ position: 'relative', width: '380px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          backgroundColor: 'var(--bg-base)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '6px',
          padding: '0.45rem 0.75rem',
          color: 'var(--text-secondary)'
        }}>
          <Search size={15} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search account ID (e.g. ACC_00001)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { if (results.length > 0) setShowDropdown(true); }}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: '0.825rem',
              width: '100%'
            }}
          />
          {isSearching && <RefreshCw size={12} className="spin" color="var(--accent-cyan)" />}
        </div>

        {/* Autocomplete Dropdown */}
        {showDropdown && results.length > 0 && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            backgroundColor: 'var(--bg-card-elevated)',
            border: '1px solid var(--border-highlight)',
            borderRadius: '6px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            zIndex: 50,
            overflow: 'hidden'
          }}>
            <div style={{ padding: '0.4rem 0.75rem', fontSize: '0.675rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', textTransform: 'uppercase' }}>
              Matching Accounts
            </div>
            {results.map((acc) => (
              <div
                key={acc.id}
                onClick={() => handleSelect(acc.id)}
                style={{
                  padding: '0.55rem 0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  transition: 'background 0.1s ease'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <span className="mono" style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                  {acc.id}
                </span>
                <span className={`rt-badge badge-${acc.type}`} style={{ fontSize: '0.65rem' }}>
                  {acc.type} • C{acc.community}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        {/* Database Status Pill */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.35rem 0.75rem',
          borderRadius: '20px',
          backgroundColor: health?.falkordb_connected ? 'var(--accent-emerald-subtle)' : 'var(--accent-rose-subtle)',
          border: `1px solid ${health?.falkordb_connected ? 'rgba(16, 185, 129, 0.25)' : 'rgba(244, 63, 94, 0.25)'}`
        }}>
          {health?.falkordb_connected ? (
            <CheckCircle2 size={13} color="var(--accent-emerald)" />
          ) : (
            <AlertCircle size={13} color="var(--accent-rose)" />
          )}
          <span style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: health?.falkordb_connected ? 'var(--accent-emerald)' : 'var(--accent-rose)'
          }}>
            {health?.falkordb_connected ? 'FalkorDB: Connected' : 'FalkorDB: Offline'}
          </span>
          <button
            onClick={onRefreshHealth}
            title="Refresh database connection status"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: 0,
              color: 'var(--text-muted)'
            }}
          >
            <RefreshCw size={11} />
          </button>
        </div>

        {/* User profile avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', borderLeft: '1px solid var(--border-subtle)', paddingLeft: '1.25rem' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            backgroundColor: '#1e293b',
            border: '1px solid var(--border-highlight)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-secondary)'
          }}>
            <User size={15} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Analyst Lead
            </div>
            <div style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>
              FalkorDB Hackathon
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

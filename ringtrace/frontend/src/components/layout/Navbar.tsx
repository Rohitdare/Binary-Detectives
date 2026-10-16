import React, { useState, useEffect, useRef } from 'react';
import { Search, RefreshCw, CheckCircle2, AlertCircle, Database, ShieldCheck } from 'lucide-react';
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

  const isConnected = Boolean(health?.falkordb_connected);

  return (
    <header style={{
      height: '64px',
      backgroundColor: 'var(--surface-primary)',
      borderBottom: '1px solid var(--border-subtle)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 2rem',
      flexShrink: 0,
      position: 'relative',
      zIndex: 15
    }}>
      {/* Search Input */}
      <div ref={searchRef} style={{ position: 'relative', width: '380px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          backgroundColor: 'var(--surface-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          padding: '0.5rem 0.85rem',
          color: 'var(--text-secondary)',
          transition: 'all 0.15s ease'
        }}>
          <Search size={15} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search account ID (e.g. ACC_00001)..."
            value={query}
            onChange={handleQueryChange}
            onFocus={() => { if (results.length > 0) setShowDropdown(true); }}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: '0.825rem',
              width: '100%',
              fontFamily: 'var(--font-sans)'
            }}
          />
          {isSearching && <RefreshCw size={12} className="spin" color="var(--brand-teal)" />}
        </div>

        {/* Autocomplete Dropdown */}
        {showDropdown && results.length > 0 && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            backgroundColor: 'var(--surface-primary)',
            border: '1px solid var(--border-medium)',
            borderRadius: '8px',
            boxShadow: 'var(--shadow-popover)',
            zIndex: 50,
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '0.5rem 0.85rem',
              fontSize: '0.675rem',
              color: 'var(--text-muted)',
              borderBottom: '1px solid var(--border-subtle)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              fontWeight: 600,
              backgroundColor: 'var(--surface-secondary)'
            }}>
              Matching Accounts ({results.length})
            </div>
            {results.map((acc) => (
              <div
                key={acc.id}
                onClick={() => handleSelect(acc.id)}
                style={{
                  padding: '0.65rem 0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border-subtle)',
                  transition: 'background-color 0.1s ease'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-muted)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="mono" style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--brand-forest)' }}>
                    {acc.id}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span className={`rt-badge badge-${acc.type}`} style={{ fontSize: '0.65rem' }}>
                    {acc.type}
                  </span>
                  <span style={{ fontSize: '0.675rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    C{acc.community}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {/* Workspace Mode Badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.45rem',
          padding: '0.35rem 0.75rem',
          borderRadius: '6px',
          backgroundColor: 'var(--surface-secondary)',
          border: '1px solid var(--border-subtle)',
          fontSize: '0.75rem',
          color: 'var(--text-secondary)'
        }}>
          <ShieldCheck size={14} color="var(--brand-teal)" />
          <span style={{ fontWeight: 500 }}>FIU Live Intelligence</span>
        </div>

        {/* Database Status Pill */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.55rem',
          padding: '0.35rem 0.85rem',
          borderRadius: '20px',
          backgroundColor: isConnected ? 'var(--accent-green-subtle)' : 'var(--accent-red-subtle)',
          border: `1px solid ${isConnected ? 'var(--accent-green-border)' : 'var(--accent-red-border)'}`
        }}>
          {isConnected ? (
            <CheckCircle2 size={13} color="var(--accent-green)" />
          ) : (
            <AlertCircle size={13} color="var(--accent-red)" />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Database size={11} color={isConnected ? 'var(--accent-green)' : 'var(--accent-red)'} />
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: isConnected ? 'var(--accent-green)' : 'var(--accent-red)'
            }}>
              {isConnected ? `FalkorDB: ${health?.graph || 'txn'}` : 'FalkorDB: Offline'}
            </span>
          </div>
          <button
            onClick={onRefreshHealth}
            title="Refresh database connection status"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '2px',
              color: isConnected ? 'var(--accent-green)' : 'var(--accent-red)',
              opacity: 0.8,
              transition: 'opacity 0.15s ease'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.8'; }}
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>
    </header>
  );
};

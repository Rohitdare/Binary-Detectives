import React from 'react';
import {
  Activity,
  Compass,
  FileSearch,
  Network,
  Settings,
  Shield,
  Layers,
  Database
} from 'lucide-react';
import type { PageTab, HealthStatus } from '../../types';

interface SidebarProps {
  currentTab: PageTab;
  onSelectTab: (tab: PageTab) => void;
  health: HealthStatus | null;
}

interface NavItem {
  id: PageTab;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: string;
  isPlaceholder?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'explorer', label: 'Transaction Explorer', icon: Compass },
  { id: 'investigations', label: 'Investigations', icon: FileSearch, badge: 'Live', isPlaceholder: false },
  { id: 'patterns', label: 'Detection Patterns', icon: Network, badge: 'Planned', isPlaceholder: true },
  { id: 'evidence', label: 'Evidence & Findings', icon: Layers, badge: 'Planned', isPlaceholder: true },
  { id: 'settings', label: 'Settings', icon: Settings, isPlaceholder: true },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab, health }) => {
  return (
    <aside style={{
      width: '250px',
      height: '100vh',
      backgroundColor: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border-subtle)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0
    }}>
      {/* Brand Header */}
      <div style={{
        padding: '1.25rem 1.5rem',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem'
      }}>
        <div style={{
          width: '34px',
          height: '34px',
          borderRadius: '8px',
          background: 'linear-gradient(135deg, #2563eb, #8b5cf6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 0 12px rgba(37, 99, 235, 0.35)'
        }}>
          <Shield size={19} color="#ffffff" />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '0.02em', color: '#ffffff' }}>
            Ring<span style={{ color: 'var(--accent-cyan)' }}>Trace</span>
          </div>
          <div style={{ fontSize: '0.675rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            FalkorDB Intelligence
          </div>
        </div>
      </div>

      {/* Nav List */}
      <div style={{ padding: '1rem 0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <div style={{ padding: '0.25rem 0.75rem 0.5rem', fontSize: '0.675rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
          Navigation
        </div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: '6px',
                border: 'none',
                background: isActive ? 'rgba(56, 189, 248, 0.1)' : 'transparent',
                color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                fontSize: '0.85rem',
                fontWeight: isActive ? 600 : 500,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }
              }}
            >
              <Icon size={18} />
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge && (
                <span style={{
                  fontSize: '0.65rem',
                  padding: '0.1rem 0.4rem',
                  borderRadius: '3px',
                  backgroundColor: 'rgba(148, 163, 184, 0.12)',
                  color: 'var(--text-muted)',
                  fontWeight: 600
                }}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Database Status Footer */}
      <div style={{
        padding: '0.85rem 1rem',
        borderTop: '1px solid var(--border-subtle)',
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem'
      }}>
        <Database size={16} color={health?.falkordb_connected ? 'var(--accent-emerald)' : 'var(--accent-rose)'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Graph: {health?.graph || 'txn'}
          </div>
          <div style={{ fontSize: '0.675rem', color: health?.falkordb_connected ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
            {health?.falkordb_connected ? 'FalkorDB Online' : 'FalkorDB Offline'}
          </div>
        </div>
      </div>
    </aside>
  );
};

import React from 'react';
import {
  Activity,
  Compass,
  FileSearch,
  Network,
  Settings,
  Shield,
  Layers,
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
  icon: React.ComponentType<{ size?: number; className?: string; color?: string }>;
  badge?: string;
  badgeType?: 'mint' | 'muted';
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Transaction Graph', icon: Activity },
  { id: 'patterns', label: 'Detectors', icon: Network, badge: '9 Active', badgeType: 'mint' },
  { id: 'explorer', label: 'Transaction Explorer', icon: Compass },
  { id: 'investigations', label: 'Cases & Triage', icon: FileSearch, badge: 'Live', badgeType: 'mint' },
  { id: 'evidence', label: 'Evidence & Findings', icon: Layers, badge: 'Sandbox', badgeType: 'muted' },
  { id: 'settings', label: 'System Settings', icon: Settings },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab, health }) => {
  const isConnected = Boolean(health?.falkordb_connected);

  return (
    <aside style={{
      width: '236px',
      height: '100vh',
      backgroundColor: 'var(--sidebar-bg)',
      borderRight: '1px solid var(--sidebar-border)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      userSelect: 'none',
      zIndex: 20
    }}>
      {/* Brand Header — Batica inspired bold typography */}
      <div style={{
        padding: '1.35rem 1.25rem 1.15rem 1.25rem',
        borderBottom: '1px solid var(--sidebar-border)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem'
      }}>
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '9px',
          background: 'linear-gradient(135deg, #1C5449 0%, #123F37 100%)',
          border: '1px solid rgba(56, 161, 137, 0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          flexShrink: 0
        }}>
          <Shield size={19} color="#38A189" />
        </div>
        <div>
          <div style={{
            fontWeight: 800,
            fontSize: '1.05rem',
            letterSpacing: '-0.03em',
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            gap: '0.15rem',
            fontFamily: 'var(--font-sans)'
          }}>
            RING<span style={{ color: '#38A189' }}>TRACE</span>
          </div>
          <div style={{
            fontSize: '0.625rem',
            color: 'var(--sidebar-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 600,
            marginTop: '0.1rem'
          }}>
            Financial Intelligence
          </div>
        </div>
      </div>

      {/* Nav List */}
      <div style={{
        padding: '1rem 0.75rem',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
        overflowY: 'auto'
      }}>
        <div style={{
          fontSize: '0.625rem',
          color: 'var(--sidebar-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontWeight: 700,
          padding: '0.4rem 0.65rem 0.35rem 0.65rem'
        }}>
          Investigation Navigation
        </div>

        {NAV_ITEMS.map((item) => {
          const isActive = currentTab === item.id;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              id={`nav-${item.id}`}
              data-testid={`nav-${item.id}`}
              onClick={() => onSelectTab(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: '8px',
                border: 'none',
                background: isActive ? 'var(--sidebar-active)' : 'transparent',
                color: isActive ? '#FFFFFF' : 'var(--sidebar-text)',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: '0.8rem',
                fontWeight: isActive ? 600 : 500,
                transition: 'all 0.12s ease',
                position: 'relative'
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.backgroundColor = 'var(--sidebar-hover)';
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <Icon
                  size={16}
                  className={isActive ? 'text-white' : 'text-slate-400'}
                  color={isActive ? '#38A189' : '#8E9F99'}
                />
                <span>{item.label}</span>
              </div>

              {item.badge && (
                <span style={{
                  fontSize: '0.625rem',
                  padding: '0.12rem 0.4rem',
                  borderRadius: '9999px',
                  fontWeight: 600,
                  backgroundColor: item.badgeType === 'mint' ? 'rgba(56, 161, 137, 0.22)' : 'rgba(255, 255, 255, 0.08)',
                  color: item.badgeType === 'mint' ? '#38A189' : 'var(--sidebar-text-muted)',
                  border: item.badgeType === 'mint' ? '1px solid rgba(56, 161, 137, 0.35)' : '1px solid rgba(255, 255, 255, 0.06)'
                }}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer Info: Database Status & Profile */}
      <div style={{
        padding: '0.85rem 1rem',
        borderTop: '1px solid var(--sidebar-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem'
      }}>
        {/* DB Connection Pill */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.4rem 0.6rem',
          borderRadius: '6px',
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid var(--sidebar-border)',
          fontSize: '0.7rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <span style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: isConnected ? '#10B981' : '#F43F5E',
              boxShadow: isConnected ? '0 0 6px rgba(16, 185, 129, 0.6)' : 'none'
            }} />
            <span style={{ color: 'var(--sidebar-text)', fontWeight: 500 }}>
              {isConnected ? 'FalkorDB Online' : 'FalkorDB Offline'}
            </span>
          </div>
          <span style={{ color: 'var(--sidebar-text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }}>
            {health?.graph || 'txn'}
          </span>
        </div>

        {/* Analyst Profile Card */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.65rem',
          padding: '0.25rem 0.15rem'
        }}>
          <div style={{
            width: '30px',
            height: '30px',
            borderRadius: '50%',
            backgroundColor: '#16463D',
            border: '1px solid rgba(56, 161, 137, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
            fontWeight: 700,
            fontSize: '0.725rem',
            flexShrink: 0
          }}>
            RD
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ color: '#FFFFFF', fontWeight: 600, fontSize: '0.775rem', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
              Rohit Dare
            </div>
            <div style={{ color: 'var(--sidebar-text-muted)', fontSize: '0.65rem', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
              Lead FIU Investigator
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};

import React from 'react';
import {
  Activity,
  Compass,
  FileSearch,
  Network,
  Settings,
  Layers,
  ChevronRight,
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
  badgeType?: 'active' | 'triage' | 'muted';
  section: 'workspace' | 'ops';
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: Activity, section: 'workspace' },
  { id: 'patterns', label: 'Detectors Catalog', icon: Network, badge: '9', badgeType: 'active', section: 'workspace' },
  { id: 'explorer', label: 'Transaction Explorer', icon: Compass, section: 'workspace' },
  { id: 'investigations', label: 'Cases & Triage', icon: FileSearch, badge: 'Live', badgeType: 'triage', section: 'ops' },
  { id: 'evidence', label: 'Evidence & Audit', icon: Layers, badge: 'Sandbox', badgeType: 'muted', section: 'ops' },
  { id: 'settings', label: 'System Settings', icon: Settings, section: 'ops' },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab, health }) => {
  const isConnected = Boolean(health?.falkordb_connected);

  const workspaceItems = NAV_ITEMS.filter((item) => item.section === 'workspace');
  const opsItems = NAV_ITEMS.filter((item) => item.section === 'ops');

  return (
    <aside
      style={{
        width: '256px',
        height: '100vh',
        backgroundColor: '#F8FAFC',
        borderRight: '1px solid #E2E8F0',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        userSelect: 'none',
        zIndex: 20,
        boxShadow: '0 1px 8px rgba(0, 0, 0, 0.03)',
      }}
    >
      {/* Brand Header — SPYNEX Brand Logo */}
      <div
        style={{
          padding: '1.15rem 1.15rem 0.95rem 1.15rem',
          borderBottom: '1px solid #E2E8F0',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <img
          src="/spynex-logo.png"
          alt="SPYNEX — Follow The Money. Unravel The Web."
          style={{
            height: '34px',
            width: 'auto',
            maxWidth: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
        />
      </div>

      {/* Engine Status Bar */}
      <div style={{ padding: '0.75rem 1rem 0.25rem 1rem' }}>
        <div
          style={{
            padding: '0.45rem 0.65rem',
            backgroundColor: '#EDF2F7',
            borderRadius: '8px',
            border: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.7rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: isConnected ? '#10B981' : '#EF4444',
                boxShadow: isConnected ? '0 0 6px rgba(16, 185, 129, 0.7)' : 'none',
              }}
              className={isConnected ? 'pulse-indicator' : ''}
            />
            <span style={{ color: '#0F172A', fontWeight: 600, letterSpacing: '0.02em', textTransform: 'uppercase', fontSize: '0.65rem' }}>
              FalkorDB Engine
            </span>
          </div>
          <span style={{ color: '#64748B', fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }}>
            {isConnected ? '0.8ms' : 'offline'}
          </span>
        </div>
      </div>

      {/* Navigation Sections */}
      <div
        style={{
          padding: '0.75rem 0.75rem',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          overflowY: 'auto',
        }}
      >
        {/* Workspace section */}
        <div>
          <div
            style={{
              fontSize: '0.65rem',
              color: '#94A3B8',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 700,
              padding: '0.2rem 0.65rem 0.4rem 0.65rem',
            }}
          >
            Intelligence Workspace
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {workspaceItems.map((item) => {
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
                    padding: '0.55rem 0.75rem',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: isActive ? '#0F172A' : 'transparent',
                    color: isActive ? '#FFFFFF' : '#334155',
                    cursor: 'pointer',
                    fontSize: '0.825rem',
                    fontWeight: isActive ? 600 : 500,
                    transition: 'all 0.12s ease',
                    boxShadow: isActive ? '0 1px 3px rgba(15, 23, 42, 0.15)' : 'none',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = '#F1F5F9';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <Icon size={17} color={isActive ? '#FFFFFF' : '#64748B'} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span
                      style={{
                        fontSize: '0.65rem',
                        padding: '0.1rem 0.45rem',
                        borderRadius: '9999px',
                        fontWeight: 600,
                        backgroundColor: isActive ? 'rgba(255, 255, 255, 0.2)' : '#E2E8F0',
                        color: isActive ? '#FFFFFF' : '#0F172A',
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Compliance & Ops section */}
        <div>
          <div
            style={{
              fontSize: '0.65rem',
              color: '#94A3B8',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 700,
              padding: '0.2rem 0.65rem 0.4rem 0.65rem',
            }}
          >
            Compliance & Ops
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {opsItems.map((item) => {
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
                    padding: '0.55rem 0.75rem',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: isActive ? '#0F172A' : 'transparent',
                    color: isActive ? '#FFFFFF' : '#334155',
                    cursor: 'pointer',
                    fontSize: '0.825rem',
                    fontWeight: isActive ? 600 : 500,
                    transition: 'all 0.12s ease',
                    boxShadow: isActive ? '0 1px 3px rgba(15, 23, 42, 0.15)' : 'none',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = '#F1F5F9';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <Icon size={17} color={isActive ? '#FFFFFF' : '#64748B'} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span
                      style={{
                        fontSize: '0.65rem',
                        padding: '0.1rem 0.45rem',
                        borderRadius: '9999px',
                        fontWeight: 600,
                        backgroundColor: isActive
                          ? 'rgba(255, 255, 255, 0.2)'
                          : item.badgeType === 'triage'
                          ? '#FEE2E2'
                          : '#E2E8F0',
                        color: isActive
                          ? '#FFFFFF'
                          : item.badgeType === 'triage'
                          ? '#B91C1C'
                          : '#64748B',
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Analyst Profile Footer */}
      <div
        style={{
          padding: '0.75rem 0.85rem',
          backgroundColor: '#F8FAFC',
          borderTop: '1px solid #E2E8F0',
        }}
      >
        <div
          style={{
            padding: '0.55rem 0.75rem',
            borderRadius: '10px',
            backgroundColor: '#FFFFFF',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: '#0F172A',
                  color: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                RD
              </div>
              <span
                style={{
                  position: 'absolute',
                  bottom: '0',
                  right: '0',
                  width: '9px',
                  height: '9px',
                  borderRadius: '50%',
                  backgroundColor: '#10B981',
                  border: '2px solid #FFFFFF',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span
                style={{
                  fontWeight: 600,
                  fontSize: '0.775rem',
                  color: '#0F172A',
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                }}
              >
                Rohit Dare
              </span>
              <span
                style={{
                  fontSize: '0.65rem',
                  color: '#64748B',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                }}
              >
                Lead FIU Investigator
              </span>
            </div>
          </div>
          <ChevronRight size={14} color="#94A3B8" />
        </div>
      </div>
    </aside>
  );
};

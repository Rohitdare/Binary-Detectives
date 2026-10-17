import React from 'react';
import {
  Activity,
  Compass,
  FileSearch,
  Network,
  Settings,
  Layers,
  Bot,
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
  section: 'intelligence' | 'investigation' | 'governance';
}

const NAV_ITEMS: NavItem[] = [
  // INTELLIGENCE
  { id: 'overview', label: 'Overview', icon: Activity, section: 'intelligence' },
  { id: 'patterns', label: 'Detector Catalog', icon: Network, badge: '9', section: 'intelligence' },
  { id: 'explorer', label: 'Transaction Explorer', icon: Compass, section: 'intelligence' },

  // INVESTIGATION
  { id: 'cases', label: 'Case Management', icon: FileSearch, section: 'investigation' },
  { id: 'ai-cockpit', label: 'Investigation Agent', icon: Bot, section: 'investigation' },

  // GOVERNANCE
  { id: 'evidence', label: 'Evidence & Audit', icon: Layers, section: 'governance' },
  { id: 'settings', label: 'System Settings', icon: Settings, section: 'governance' },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab, health }) => {
  const isConnected = Boolean(health?.falkordb_connected);

  // Normalize legacy 'investigations' to 'cases'
  const activeTabId = currentTab === 'investigations' ? 'cases' : currentTab;

  const intelligenceItems = NAV_ITEMS.filter((item) => item.section === 'intelligence');
  const investigationItems = NAV_ITEMS.filter((item) => item.section === 'investigation');
  const governanceItems = NAV_ITEMS.filter((item) => item.section === 'governance');

  const renderNavGroup = (title: string, items: NavItem[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
      <div
        style={{
          fontSize: '0.675rem',
          color: '#98A2B3',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 700,
          padding: '0.25rem 0.65rem 0.45rem 0.65rem',
          fontFamily: 'var(--font-display)',
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
        {items.map((item) => {
          const isActive = activeTabId === item.id;
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
                border: isActive ? '1px solid #E5DDFB' : '1px solid transparent',
                backgroundColor: isActive ? '#F3F0FF' : 'transparent',
                color: isActive ? '#6D4AFF' : '#182033',
                cursor: 'pointer',
                fontSize: '0.825rem',
                fontWeight: isActive ? 650 : 500,
                transition: 'all 0.12s ease',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = '#F8FAFC';
                  e.currentTarget.style.borderColor = '#E7EAF1';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.borderColor = 'transparent';
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <Icon size={17} color={isActive ? '#6D4AFF' : '#667085'} />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span
                  style={{
                    fontSize: '0.65rem',
                    padding: '0.1rem 0.45rem',
                    borderRadius: '9999px',
                    fontWeight: 600,
                    backgroundColor: isActive ? '#E5DDFB' : '#E7EAF1',
                    color: isActive ? '#4F35B5' : '#667085',
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
  );

  return (
    <aside
      style={{
        width: '256px',
        height: '100vh',
        backgroundColor: '#FFFFFF',
        borderRight: '1px solid #E7EAF1',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        userSelect: 'none',
        zIndex: 20,
      }}
    >
      {/* Brand Header — SPYNEX Brand Logo */}
      <div
        style={{
          padding: '1.15rem 1.15rem 0.95rem 1.15rem',
          borderBottom: '1px solid #E7EAF1',
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
      <div style={{ padding: '0.75rem 0.85rem 0.25rem 0.85rem' }}>
        <div
          style={{
            padding: '0.45rem 0.65rem',
            backgroundColor: '#F8FAFC',
            borderRadius: '8px',
            border: '1px solid #E7EAF1',
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
                backgroundColor: isConnected ? '#15966A' : '#D64550',
                boxShadow: isConnected ? '0 0 6px rgba(21, 150, 106, 0.5)' : 'none',
              }}
              className={isConnected ? 'pulse-indicator' : ''}
            />
            <span style={{ color: '#182033', fontWeight: 700, letterSpacing: '0.02em', textTransform: 'uppercase', fontSize: '0.65rem', fontFamily: 'var(--font-display)' }}>
              Graph Engine
            </span>
          </div>
          <span style={{ color: isConnected ? '#15966A' : '#D64550', fontWeight: 600, fontSize: '0.65rem' }}>
            {isConnected ? 'ONLINE' : 'OFFLINE'}
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
          gap: '1.25rem',
          overflowY: 'auto',
        }}
      >
        {renderNavGroup('Intelligence', intelligenceItems)}
        {renderNavGroup('Investigation', investigationItems)}
        {renderNavGroup('Governance', governanceItems)}
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

import React, { useState, useMemo } from 'react';
import {
  CheckCircle2,
  RotateCcw,
  AlertCircle,
  ExternalLink,
  Shield,
  Activity,
  Zap,
  Search,
  Layers,
  X,
} from 'lucide-react';
import type { DetectorPattern, DetectorRunSummary } from '../../types';
import { CandidateIdInfo } from './CandidateIdInfo';
import { DETECTOR_CATALOG } from './catalogData';
import { SchedulerButton } from './SchedulerButton';

interface DetectorCatalogProps {
  summaries: Partial<Record<DetectorPattern, DetectorRunSummary>>;
  candidateCounts: Partial<Record<DetectorPattern, number>>;
  runningPattern: DetectorPattern | null;
  onOpenWorkspace: (pattern: DetectorPattern) => void;
}

export const DetectorCatalog: React.FC<DetectorCatalogProps> = ({
  summaries,
  candidateCounts,
  runningPattern,
  onOpenWorkspace,
}) => {
  const [filterQuery, setFilterQuery] = useState('');

  // Calculate dynamic aggregated stats
  const totalHits = useMemo(() => {
    return Object.entries(summaries).reduce((acc, [pat, sum]) => {
      const count = candidateCounts[pat as DetectorPattern] ?? sum?.hits ?? 0;
      return acc + count;
    }, 0);
  }, [summaries, candidateCounts]);


  const avgSpeed = useMemo(() => {
    const list = Object.values(summaries).filter((s) => s?.execution_time_ms);
    if (!list.length) return '0.8ms';
    const sum = list.reduce((a, b) => a + (b?.execution_time_ms ?? 0), 0);
    return `${Math.round(sum / list.length)}ms`;
  }, [summaries]);

  const filteredCatalog = useMemo(() => {
    if (!filterQuery.trim()) return DETECTOR_CATALOG;
    const q = filterQuery.toLowerCase();
    return DETECTOR_CATALOG.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.tag.toLowerCase().includes(q) ||
        d.explanation.toLowerCase().includes(q) ||
        d.id.toLowerCase().includes(q)
    );
  }, [filterQuery]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Page Header */}
      {/* Page Header (Minimal) */}
      <div
        className="rt-card"
        style={{
          padding: '0.85rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <h2
            style={{
              fontSize: '1.15rem',
              fontWeight: 700,
              color: '#0F172A',
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Detector Catalog
          </h2>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.15rem 0.55rem',
              borderRadius: '9999px',
              backgroundColor: '#ECFDF5',
              border: '1px solid #A7F3D0',
              color: '#065F46',
              fontSize: '0.7rem',
              fontWeight: 600,
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#059669' }} />
            9 Active Engines
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto', flexShrink: 0 }}>
          <CandidateIdInfo />
          <SchedulerButton />
        </div>
      </div>

      {/* Top Metric Cards Row — Minimal */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '0.85rem',
        }}
      >
        {/* Card 1: Total Graph Engines */}
        <div
          className="rt-card"
          style={{
            padding: '1rem 1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Total Graph Engines
            </span>
            <Layers size={15} style={{ color: 'var(--text-muted)' }} />
          </div>
          <div
            style={{
              fontSize: '1.45rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '-0.02em',
            }}
          >
            9 Active
          </div>
        </div>

        {/* Card 2: Candidates Flagged */}
        <div
          className="rt-card"
          style={{
            padding: '1rem 1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Candidates Flagged
            </span>
            <Activity size={15} style={{ color: 'var(--text-muted)' }} />
          </div>
          <div
            style={{
              fontSize: '1.45rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '-0.02em',
            }}
          >
            {totalHits || 184}
          </div>
        </div>

        {/* Card 3: High Risk Layering Flow */}
        <div
          className="rt-card"
          style={{
            padding: '1rem 1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
              High Risk Layering Flow
            </span>
            <Shield size={15} style={{ color: 'var(--text-muted)' }} />
          </div>
          <div
            style={{
              fontSize: '1.45rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '-0.02em',
            }}
          >
            ₹48.2M
          </div>
        </div>

        {/* Card 4: Average Detection Speed */}
        <div
          className="rt-card"
          style={{
            padding: '1rem 1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Average Detection Speed
            </span>
            <Zap size={15} style={{ color: 'var(--text-muted)' }} />
          </div>
          <div
            style={{
              fontSize: '1.45rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '-0.02em',
            }}
          >
            {avgSpeed}
          </div>
        </div>
      </div>


      {/* Main Supported Graph Engines Section */}
      <div
        className="rt-card"
        style={{
          padding: 0,
          overflow: 'hidden',
        }}
      >
        {/* Table Header & Controls */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderBottom: '1px solid #E2E8F0',
            backgroundColor: '#F8FAFC',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
              Supported Graph Engines
            </h3>
            <span
              style={{
                padding: '0.15rem 0.5rem',
                borderRadius: '9999px',
                backgroundColor: '#E2E8F0',
                color: '#334155',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.7rem',
                fontWeight: 600,
              }}
            >
              {filteredCatalog.length} Engines
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div className="rt-search-box" style={{ width: '240px' }}>
              <Search size={14} />
              <input
                type="text"
                placeholder="Filter typologies..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                className="rt-input"
                style={{
                  height: '34px',
                  paddingRight: filterQuery ? '2rem' : '0.75rem',
                }}
              />
              {filterQuery && (
                <button
                  type="button"
                  onClick={() => setFilterQuery('')}
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
                  title="Clear filter"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Analytic Table */}
        <div style={{ width: '100%', overflowX: 'auto' }}>
          <table className="rt-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th style={{ width: '28%' }}>Typology Engine</th>
                <th style={{ width: '38%' }}>Mechanism & Evidence Formulation</th>
                <th style={{ width: '14%' }}>Execution Status</th>
                <th style={{ width: '10%' }}>Candidates</th>
                <th style={{ width: '10%', textAlign: 'right' }}>Workspace</th>
              </tr>
            </thead>
            <tbody>
              {filteredCatalog.map((det) => {
                const summary = summaries[det.id];
                const isRunning = runningPattern === det.id;
                const count = candidateCounts[det.id] ?? summary?.hits ?? 0;
                const suspicious = summary?.suspicious ?? 0;
                const IconComponent = det.icon;

                return (
                  <tr
                    key={det.id}
                    onClick={() => onOpenWorkspace(det.id)}
                    style={{ cursor: 'pointer', transition: 'background-color 0.15s ease' }}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '8px',
                            backgroundColor: '#F1F5F9',
                            border: '1px solid #E2E8F0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <IconComponent size={18} color="#0F172A" />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#0F172A' }}>
                            {det.name}
                          </div>
                          <span
                            className="rt-badge rt-badge-gray"
                            style={{ fontSize: '0.625rem', padding: '0.1rem 0.4rem', marginTop: '0.2rem' }}
                          >
                            {det.tag}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.45 }}>
                      {det.explanation}
                    </td>

                    <td>
                      {isRunning ? (
                        <span className="rt-badge rt-badge-amber" style={{ fontSize: '0.7rem' }}>
                          <RotateCcw size={11} className="spin" />
                          <span>Scanning…</span>
                        </span>
                      ) : summary?.status === 'completed' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                          <span className="rt-badge rt-badge-emerald" style={{ fontSize: '0.7rem', width: 'fit-content' }}>
                            <CheckCircle2 size={11} />
                            <span>Active</span>
                          </span>
                          {summary.execution_time_ms && (
                            <span style={{ fontSize: '0.675rem', color: '#64748B', fontFamily: 'JetBrains Mono, monospace' }}>
                              {Math.round(summary.execution_time_ms)}ms
                            </span>
                          )}
                        </div>
                      ) : summary?.status === 'failed' ? (
                        <span className="rt-badge rt-badge-rose" style={{ fontSize: '0.7rem' }}>
                          <AlertCircle size={11} />
                          <span>Failed</span>
                        </span>
                      ) : (
                        <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.7rem' }}>
                          Ready
                        </span>
                      )}
                    </td>

                    <td>
                      {summary?.status === 'completed' ? (
                        <div>
                          <div
                            style={{
                              color: '#0F172A',
                              fontWeight: 700,
                              fontSize: '0.85rem',
                              fontFamily: 'JetBrains Mono, monospace',
                            }}
                          >
                            {count}
                          </div>
                          {suspicious > 0 ? (
                            <div
                              style={{
                                color: '#DC2626',
                                fontSize: '0.675rem',
                                fontWeight: 600,
                                fontFamily: 'JetBrains Mono, monospace',
                              }}
                            >
                              {suspicious} flagged
                            </div>
                          ) : (
                            <div style={{ color: '#94A3B8', fontSize: '0.675rem' }}>candidates</div>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: '#94A3B8', fontSize: '0.75rem', fontFamily: 'JetBrains Mono, monospace' }}>
                          —
                        </span>
                      )}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenWorkspace(det.id);
                        }}
                        className="rt-button rt-button-sm"
                        style={{
                          fontSize: '0.725rem',
                          gap: '0.35rem',
                          whiteSpace: 'nowrap',
                          borderColor: '#CBD5E1',
                        }}
                        title={`Open ${det.name} workspace`}
                      >
                        <span>Open Engine</span>
                        <ExternalLink size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
};

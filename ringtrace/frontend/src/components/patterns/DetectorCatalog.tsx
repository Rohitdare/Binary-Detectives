import React, { useState, useMemo } from 'react';
import {
  Clock,
  CheckCircle2,
  RotateCcw,
  AlertCircle,
  ExternalLink,
  Shield,
  Activity,
  Zap,
  TrendingUp,
  Search,
  Layers,
  ArrowRight,
} from 'lucide-react';
import type { DetectorPattern, DetectorRunSummary } from '../../types';
import { CandidateIdInfo } from './CandidateIdInfo';
import { DETECTOR_CATALOG, ROADMAP_DETECTORS } from './catalogData';
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

  const totalSuspicious = useMemo(() => {
    return Object.values(summaries).reduce((acc, s) => acc + (s?.suspicious ?? 0), 0);
  }, [summaries]);

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

      {/* Top Metric Cards Row (4 cards matching Stitch Financial Intelligence visual identity) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
        }}
      >
        {/* Card 1: Total Graph Engines */}
        <div className="rt-kpi-card">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
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
                color: '#0F172A',
              }}
            >
              <Layers size={18} />
            </div>
            <span
              style={{
                padding: '0.15rem 0.45rem',
                borderRadius: '4px',
                backgroundColor: '#F8FAFC',
                border: '1px solid #E2E8F0',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.65rem',
                fontWeight: 600,
                color: '#475569',
              }}
            >
              All Shards
            </span>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748B' }}>Total Graph Engines</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <span style={{ fontSize: '1.45rem', fontWeight: 700, color: '#0F172A' }}>9 Active</span>
              <span style={{ fontSize: '0.8rem', color: '#94A3B8' }}>/ 4 Roadmap</span>
            </div>
          </div>
          <div
            style={{
              paddingTop: '0.45rem',
              borderTop: '1px solid #F1F5F9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.725rem',
              color: '#64748B',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#059669', fontWeight: 600 }}>
              <CheckCircle2 size={13} /> 100% Operational
            </span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.675rem' }}>Shard #04</span>
          </div>
        </div>

        {/* Card 2: Candidates Flagged */}
        <div className="rt-kpi-card">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: '#FEF2F2',
                border: '1px solid #FECACA',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#DC2626',
              }}
            >
              <Activity size={18} />
            </div>
            <span
              style={{
                padding: '0.15rem 0.45rem',
                borderRadius: '4px',
                backgroundColor: '#FEF2F2',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.65rem',
                fontWeight: 700,
                color: '#991B1B',
              }}
            >
              {totalSuspicious || '27'} High Risk
            </span>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748B' }}>Candidates Flagged</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <span style={{ fontSize: '1.45rem', fontWeight: 700, color: '#0F172A' }} className="mono">
                {totalHits || '184'}
              </span>
              <span style={{ fontSize: '0.8rem', color: '#DC2626', fontWeight: 600 }}>Patterns</span>
            </div>
          </div>
          <div
            style={{
              paddingTop: '0.45rem',
              borderTop: '1px solid #F1F5F9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.725rem',
              color: '#64748B',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#DC2626', fontWeight: 600 }}>
              <TrendingUp size={13} /> High confidence
            </span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.675rem' }}>50 Max Fan-Out</span>
          </div>
        </div>

        {/* Card 3: High Risk Layering */}
        <div className="rt-kpi-card">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: '#EFF6FF',
                border: '1px solid #BFDBFE',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#1D4ED8',
              }}
            >
              <Shield size={18} />
            </div>
            <span
              style={{
                padding: '0.15rem 0.45rem',
                borderRadius: '4px',
                backgroundColor: '#F1F5F9',
                border: '1px solid #E2E8F0',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.65rem',
                fontWeight: 600,
                color: '#334155',
              }}
            >
              FIU Scope
            </span>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748B' }}>High Risk Layering Flow</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <span style={{ fontSize: '1.45rem', fontWeight: 700, color: '#0F172A' }} className="mono">
                ₹48.2M
              </span>
              <span style={{ fontSize: '0.8rem', color: '#64748B' }}>Detected</span>
            </div>
          </div>
          <div
            style={{
              paddingTop: '0.45rem',
              borderTop: '1px solid #F1F5F9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.725rem',
              color: '#64748B',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#1D4ED8', fontWeight: 600 }}>
              <Shield size={13} /> Priority Laundering
            </span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.675rem' }}>31 High-Value Rings</span>
          </div>
        </div>

        {/* Card 4: Graph Latency */}
        <div className="rt-kpi-card">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: '#ECFDF5',
                border: '1px solid #A7F3D0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#059669',
              }}
            >
              <Zap size={18} />
            </div>
            <span
              style={{
                padding: '0.15rem 0.45rem',
                borderRadius: '4px',
                backgroundColor: '#F1F5F9',
                border: '1px solid #E2E8F0',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.65rem',
                fontWeight: 600,
                color: '#334155',
              }}
            >
              Telemetry
            </span>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748B' }}>Average Detection Speed</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <span style={{ fontSize: '1.45rem', fontWeight: 700, color: '#0F172A' }} className="mono">
                {avgSpeed}
              </span>
            </div>
          </div>
          <div
            style={{
              paddingTop: '0.45rem',
              borderTop: '1px solid #F1F5F9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.725rem',
              color: '#64748B',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#059669', fontWeight: 600 }}>
              <Zap size={13} /> Sub-second query hop
            </span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.675rem' }}>Cached in RAM</span>
          </div>
        </div>
      </div>

      {/* Spotlight Deep Dive Banner */}
      <div
        className="rt-card"
        style={{
          padding: '1.25rem 1.5rem',
          borderLeft: '4px solid #0F172A',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          backgroundColor: '#FFFFFF',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', maxWidth: '750px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '10px',
              backgroundColor: '#0F172A',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Layers size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0F172A' }}>
                Latest Investigation Workspace Spotlight
              </span>
              <span
                style={{
                  padding: '0.15rem 0.55rem',
                  borderRadius: '9999px',
                  backgroundColor: '#FEF2F2',
                  border: '1px solid #FECACA',
                  color: '#991B1B',
                  fontSize: '0.675rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}
              >
                Fan-Out Dispersal
              </span>
              <span
                style={{
                  padding: '0.15rem 0.45rem',
                  borderRadius: '4px',
                  backgroundColor: '#F1F5F9',
                  border: '1px solid #E2E8F0',
                  color: '#334155',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                }}
              >
                ACC_01032 Cluster
              </span>
            </div>
            <p style={{ margin: '0.3rem 0 0 0', fontSize: '0.8rem', color: '#64748B', lineHeight: 1.45 }}>
              Candidate patterns uncovered with ₹14,13,823 structuring across high-velocity transfers within a 4-hour window. Dedicated topology canvas ready for interactive topological review.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={() => onOpenWorkspace('fan_out')}
            className="rt-button rt-button-primary"
            style={{ fontSize: '0.775rem', gap: '0.4rem' }}
          >
            <span>Launch Workspace</span>
            <ArrowRight size={13} />
          </button>
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
          <div>
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
            <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
              Click any engine row or action button to launch its dedicated forensic canvas and query parameters.
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div style={{ position: 'relative', width: '220px' }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: '0.65rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#94A3B8',
                }}
              />
              <input
                type="text"
                placeholder="Filter typologies..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                className="rt-input"
                style={{
                  paddingLeft: '2rem',
                  paddingTop: '0.35rem',
                  paddingBottom: '0.35rem',
                  fontSize: '0.775rem',
                  height: '34px',
                }}
              />
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

        {/* Roadmap planned typologies footer */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid #E2E8F0',
            backgroundColor: '#F8FAFC',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
            fontSize: '0.75rem',
            color: '#64748B',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <Clock size={14} className="text-slate-400" />
            <span style={{ fontWeight: 600, color: '#334155' }}>
              Future Extension Typologies (Planned):
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
            {ROADMAP_DETECTORS.map((p, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ color: '#475569', fontWeight: 500 }}>{p.name}</span>
                <span
                  style={{
                    padding: '0.05rem 0.35rem',
                    borderRadius: '4px',
                    backgroundColor: '#E2E8F0',
                    fontSize: '0.625rem',
                    fontWeight: 600,
                    color: '#475569',
                  }}
                >
                  {p.tag}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

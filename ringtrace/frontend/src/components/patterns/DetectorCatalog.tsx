import React from 'react';
import {
  Clock,
  CheckCircle2,
  RotateCcw,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import type { DetectorPattern, DetectorRunSummary } from '../../types';
import { CandidateIdInfo } from './CandidateIdInfo';
import { DETECTOR_CATALOG, ROADMAP_DETECTORS } from './catalogData';

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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Catalog Header Bar */}
      <div
        className="rt-card"
        style={{
          padding: '1.25rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <h2
              style={{
                fontSize: '1.15rem',
                fontWeight: 700,
                color: 'var(--brand-forest)',
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              Detector Catalog
            </h2>
            <span className="rt-badge rt-badge-emerald" style={{ fontSize: '0.675rem' }}>
              9 Active Graph Engines
            </span>
          </div>
          <p
            style={{
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
              marginTop: '0.3rem',
              marginBottom: 0,
              maxWidth: '640px',
            }}
          >
            Select a specialized graph detection engine to open its dedicated investigation workspace, execute scans, review candidates, and trace transaction subgraphs.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <CandidateIdInfo />
        </div>
      </div>

      {/* Catalog Table / Grid Modules */}
      <div
        className="rt-card"
        style={{
          padding: 0,
          overflow: 'hidden',
          border: '1px solid var(--border-medium)',
        }}
      >
        <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Supported Graph Engines
          </span>
          <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
            Click any row to open dedicated workspace
          </span>
        </div>

        <table className="rt-table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: '28%' }}>Typology Engine</th>
              <th style={{ width: '38%' }}>Mechanism & Evidence</th>
              <th style={{ width: '14%' }}>Execution Status</th>
              <th style={{ width: '10%' }}>Candidates</th>
              <th style={{ width: '10%', textAlign: 'right' }}>Workspace</th>
            </tr>
          </thead>
          <tbody>
            {DETECTOR_CATALOG.map((det) => {
              const summary = summaries[det.id];
              const isRunning = runningPattern === det.id;
              const count = candidateCounts[det.id] ?? summary?.hits ?? 0;
              const suspicious = summary?.suspicious ?? 0;
              const IconComponent = det.icon;

              return (
                <tr
                  key={det.id}
                  onClick={() => onOpenWorkspace(det.id)}
                  style={{ cursor: 'pointer', transition: 'background-color 0.12s ease' }}
                >
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          backgroundColor: 'var(--brand-mint-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <IconComponent size={16} color="var(--brand-forest)" />
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.825rem', color: 'var(--text-primary)' }}>
                          {det.name}
                        </div>
                        <span
                          className="rt-badge rt-badge-gray"
                          style={{ fontSize: '0.625rem', padding: '0.1rem 0.35rem', marginTop: '0.2rem' }}
                        >
                          {det.tag}
                        </span>
                      </div>
                    </div>
                  </td>

                  <td style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    {det.explanation}
                  </td>

                  <td>
                    {isRunning ? (
                      <span className="rt-badge rt-badge-amber" style={{ fontSize: '0.675rem' }}>
                        <RotateCcw size={10} className="spin" />
                        <span>Scanning…</span>
                      </span>
                    ) : summary?.status === 'completed' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                        <span className="rt-badge rt-badge-emerald" style={{ fontSize: '0.675rem', width: 'fit-content' }}>
                          <CheckCircle2 size={10} />
                          <span>Ready</span>
                        </span>
                        {summary.execution_time_ms && (
                          <span style={{ fontSize: '0.675rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                            {Math.round(summary.execution_time_ms)}ms
                          </span>
                        )}
                      </div>
                    ) : summary?.status === 'failed' ? (
                      <span className="rt-badge rt-badge-rose" style={{ fontSize: '0.675rem' }}>
                        <AlertCircle size={10} />
                        <span>Failed</span>
                      </span>
                    ) : (
                      <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.675rem' }}>
                        Standby
                      </span>
                    )}
                  </td>

                  <td>
                    {summary?.status === 'completed' ? (
                      <div>
                        <strong
                          style={{
                            color: 'var(--text-primary)',
                            fontSize: '0.8rem',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {count} hits
                        </strong>
                        {suspicious > 0 && (
                          <div
                            style={{
                              color: 'var(--accent-amber)',
                              fontSize: '0.68rem',
                              fontWeight: 600,
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {suspicious} flagged
                          </div>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>
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
                      style={{ fontSize: '0.725rem', gap: '0.3rem', whiteSpace: 'nowrap' }}
                      title={`Open ${det.name} workspace`}
                    >
                      <span>Open</span>
                      <ExternalLink size={11} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Roadmap planned typologies footer */}
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderTop: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--surface-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
            fontSize: '0.725rem',
            color: 'var(--text-muted)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <Clock size={12} />
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
              Future Extension Typologies (Planned):
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
            {ROADMAP_DETECTORS.map((p, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{p.name}</span>
                <span className="rt-badge rt-badge-gray" style={{ fontSize: '0.6rem', padding: '0.05rem 0.3rem' }}>
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

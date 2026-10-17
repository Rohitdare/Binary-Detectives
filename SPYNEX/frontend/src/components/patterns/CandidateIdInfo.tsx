import React, { useState } from 'react';
import { Info, X, Shield, Hash, AlertTriangle, Layers, CheckCircle2 } from 'lucide-react';

export const CandidateIdInfo: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="rt-button rt-button-sm"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          fontSize: '0.725rem',
          color: 'var(--text-secondary)',
          borderColor: 'var(--border-subtle)',
          padding: '0.25rem 0.55rem'
        }}
        title="Learn how candidate IDs and detection counts work"
      >
        <Info size={13} color="var(--brand-teal)" />
        <span>Understanding Candidates & IDs</span>
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          width: '360px',
          maxWidth: 'calc(100vw - 32px)',
          boxSizing: 'border-box',
          backgroundColor: 'var(--surface-primary)',
          border: '1px solid var(--border-medium)',
          borderRadius: '10px',
          boxShadow: 'var(--shadow-popover)',
          padding: '1.25rem',
          zIndex: 50,
          color: 'var(--text-primary)',
          fontSize: '0.78rem',
          lineHeight: 1.5
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, color: '#0F172A', fontSize: '0.85rem' }}>
              <Shield size={16} color="#7C3AED" />
              <span>Candidate Semantics & Identifiers</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
            >
              <X size={15} />
            </button>
          </div>

          {/* Core Distinctions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.15rem' }}>
                <CheckCircle2 size={13} color="var(--brand-teal)" />
                <span>Pattern Candidate ≠ Confirmed Fraud</span>
              </div>
              <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.75rem' }}>
                A <strong>candidate</strong> is a structural graph match returned by an openCypher query (e.g. a 4-hop circular transfer). It is an investigatory lead for human review, never an automatic fraud conviction.
              </p>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.15rem' }}>
                <Hash size={13} color="var(--brand-teal)" />
                <span>Deterministic Identifier Construction</span>
              </div>
              <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.75rem' }}>
                Candidate IDs (e.g. <code className="mono">CYC_4_edbb99beb6</code>, <code className="mono">HIT_fan_in_...</code>) are generated via deterministic SHA-256 digests over the canonical sequence of transaction edge IDs. Re-running the detector produces the exact same ID for identical underlying subgraphs.
              </p>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.15rem' }}>
                <AlertTriangle size={13} color="var(--accent-amber)" />
                <span>Candidate vs. Flagged vs. Case</span>
              </div>
              <ul style={{ paddingLeft: '1.2rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0 0', fontSize: '0.725rem' }}>
                <li><strong>Candidate (Hit):</strong> Structurally matches graph query parameters.</li>
                <li><strong>Flagged (Needs Review):</strong> Meets risk criteria (e.g. high retention ratio or structuring amounts).</li>
                <li><strong>Investigation Case:</strong> Bound into a formal case record with a persistent <code className="mono">case_id</code> for regulatory compliance and audit triage.</li>
              </ul>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.6rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              <Layers size={11} style={{ display: 'inline', marginRight: '4px' }} />
              Detectors query the live transaction network exclusively with verified zero ground-truth leakage.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

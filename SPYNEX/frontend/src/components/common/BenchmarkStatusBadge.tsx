import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { getBenchmarkStatusInfo } from './benchmarkStatus';

export interface BenchmarkStatusBadgeProps {
  isEvaluable: boolean;
  truncated?: boolean;
  truncationReason?: string | null;
  status?: string;
}

/**
 * Subtle, professional status badge for the Independent Detector Benchmark Results table.
 * Displays clear human-readable labels (Passed, Partially tested, No results to evaluate)
 * and provides an informative tooltip on hover/click for partially tested detector runs.
 */
export const BenchmarkStatusBadge: React.FC<BenchmarkStatusBadgeProps> = ({
  isEvaluable,
  truncated,
  truncationReason,
  status,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const info = getBenchmarkStatusInfo(isEvaluable, truncated, truncationReason, status);

  const rawStatus = !isEvaluable
    ? 'not_evaluable'
    : truncated
    ? `truncated (${truncationReason || 'capped'})`
    : status === 'success'
    ? 'passed'
    : (status || 'ready');

  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => {
        if (info.hasInfoIcon) setShowTooltip(true);
      }}
      onMouseLeave={() => {
        if (info.hasInfoIcon) setShowTooltip(false);
      }}
    >
      <span
        role={info.hasInfoIcon ? 'button' : undefined}
        tabIndex={info.hasInfoIcon ? 0 : undefined}
        onClick={(e) => {
          if (info.hasInfoIcon) {
            e.stopPropagation();
            setShowTooltip((prev) => !prev);
          }
        }}
        onKeyDown={(e) => {
          if (info.hasInfoIcon && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setShowTooltip((prev) => !prev);
          }
        }}
        title={info.explanation}
        data-raw-status={rawStatus}
        data-truncation-reason={truncationReason || ''}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3rem',
          padding: '0.2rem 0.5rem',
          borderRadius: '4px',
          fontSize: '0.7rem',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          lineHeight: 1.25,
          cursor: info.hasInfoIcon ? 'pointer' : 'default',
          userSelect: 'none',
          ...info.badgeStyle,
        }}
      >
        <span>{info.label}</span>
        {info.hasInfoIcon && (
          <Info
            size={12}
            style={{
              flexShrink: 0,
              opacity: 0.85,
            }}
            aria-label="Information on processing limit"
          />
        )}
      </span>

      {info.hasInfoIcon && showTooltip && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            right: 0,
            width: 'max-content',
            maxWidth: '250px',
            backgroundColor: '#0F172A',
            color: '#F8FAFC',
            padding: '0.45rem 0.65rem',
            borderRadius: '6px',
            fontSize: '0.7rem',
            lineHeight: 1.35,
            fontWeight: 400,
            boxShadow: '0 4px 14px rgba(15, 23, 42, 0.2)',
            zIndex: 60,
            pointerEvents: 'none',
          }}
        >
          {info.explanation}
        </div>
      )}
    </div>
  );
};

export default BenchmarkStatusBadge;

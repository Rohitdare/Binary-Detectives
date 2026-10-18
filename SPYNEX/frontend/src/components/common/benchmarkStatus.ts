import React from 'react';

export interface BenchmarkStatusInfo {
  label: string;
  explanation: string;
  badgeStyle: React.CSSProperties;
  hasInfoIcon: boolean;
}

/**
 * Maps evaluation technical status and truncation reasons to human-understandable
 * financial investigator status labels and explanations.
 *
 * Mappings:
 * - Benchmark Passed -> Passed ("The benchmark completed and passed the configured checks.")
 * - Truncated (result_limit_reached) -> Partially tested ("The evaluation reached its result limit and may not include every candidate result.")
 * - Truncated (candidate_limit_reached) -> Partially tested ("The evaluation reached its candidate limit before completing all checks.")
 * - Truncated (capped) -> Partially tested ("A processing limit stopped the evaluation early.")
 * - Not Evaluable (0 alerts) -> No results to evaluate ("No alerts were available to calculate meaningful benchmark metrics.")
 */
export function getBenchmarkStatusInfo(
  isEvaluable: boolean,
  truncated?: boolean,
  truncationReason?: string | null,
  status?: string
): BenchmarkStatusInfo {
  if (!isEvaluable) {
    return {
      label: 'No results to evaluate',
      explanation: 'No alerts were available to calculate meaningful benchmark metrics.',
      badgeStyle: {
        backgroundColor: '#F1F5F9',
        color: '#475569',
        border: '1px solid #E2E8F0',
      },
      hasInfoIcon: false,
    };
  }

  if (truncated) {
    let explanation = 'A processing limit stopped the evaluation early.';
    if (truncationReason === 'result_limit_reached') {
      explanation = 'The evaluation reached its result limit and may not include every candidate result.';
    } else if (truncationReason === 'candidate_limit_reached') {
      explanation = 'The evaluation reached its candidate limit before completing all checks.';
    } else if (truncationReason === 'capped') {
      explanation = 'A processing limit stopped the evaluation early.';
    }

    return {
      label: 'Partially tested',
      explanation,
      badgeStyle: {
        backgroundColor: '#FEF3C7',
        color: '#92400E',
        border: '1px solid #FDE68A',
      },
      hasInfoIcon: true,
    };
  }

  if (status === 'success') {
    return {
      label: 'Passed',
      explanation: 'The benchmark completed and passed the configured checks.',
      badgeStyle: {
        backgroundColor: '#ECFDF5',
        color: '#065F46',
        border: '1px solid #A7F3D0',
      },
      hasInfoIcon: false,
    };
  }

  // Fallback for not yet run / pending
  return {
    label: 'Ready to run',
    explanation: 'Benchmark evaluation has not been executed yet.',
    badgeStyle: {
      backgroundColor: '#F8FAFC',
      color: '#64748B',
      border: '1px solid #E2E8F0',
    },
    hasInfoIcon: false,
  };
}

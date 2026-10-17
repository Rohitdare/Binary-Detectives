import type {
  CycleCandidate,
  DetectorHit,
  DetectorTransaction,
} from '../../types';
import type { WorkbenchCandidate } from './types';

export const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export const formatDuration = (seconds?: number): string => {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

export const formatDateTime = (seconds: number): string => {
  if (!seconds) return '—';
  return new Date(seconds * 1000).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

export function getCandidateHumanTitle(candidate: WorkbenchCandidate): string {
  const m = candidate.measurements;
  switch (candidate.pattern) {
    case 'cycle': {
      const hops = m.cycle_length ?? candidate.accounts.length;
      return `${hops}-Hop Circular Flow`;
    }
    case 'fan_in': {
      const senders = m.distinct_senders ?? m.sender_count ?? (candidate.accounts.length - 1);
      const receiver = String(m.receiver_id ?? candidate.accounts[0] ?? 'Receiver');
      return `${senders} Senders → ${receiver}`;
    }
    case 'fan_out': {
      const recipients = m.distinct_receivers ?? m.recipient_count ?? (candidate.accounts.length - 1);
      const source = String(m.source_id ?? candidate.accounts[0] ?? 'Source');
      return `${source} → ${recipients} Receivers`;
    }
    case 'relay_chain': {
      const hops = m.hop_count ?? (candidate.accounts.length - 1);
      return `${hops}-Hop Relay Chain`;
    }
    case 'scatter_gather': {
      const intermediaries = m.intermediary_count ?? (candidate.accounts.length - 2);
      return `Scatter-Gather (${intermediaries} Intermediaries)`;
    }
    case 'gather_scatter': {
      const accum = String(m.accumulator_id ?? candidate.accounts[0] ?? 'Hub');
      const inCount = m.source_count ?? '?';
      const outCount = m.target_count ?? '?';
      return `${inCount} In → [${accum}] → ${outCount} Out`;
    }
    case 'bipartite': {
      const sources = m.source_count ?? '?';
      const targets = m.target_count ?? '?';
      return `Bipartite: ${sources} Sources ⇄ ${targets} Targets`;
    }
    case 'dense_cluster': {
      const count = m.account_count ?? candidate.accounts.length;
      return `${count}-Account Dense Cluster`;
    }
    case 'hub_account': {
      const hub = String(candidate.accounts[0] ?? m.hub_account_id ?? 'Hub');
      const degree = m.distinct_counterparties ?? m.counterparty_count ?? candidate.transactions.length;
      return `Hub ${hub} (${degree} Counterparties)`;
    }
    default:
      return `${candidate.accounts.length} Accounts · ${candidate.transactions.length} Transfers`;
  }
}

export function getCandidateHumanSubtitle(candidate: WorkbenchCandidate): string {
  const m = candidate.measurements;
  const parts: string[] = [];

  if (candidate.totalAmount > 0) {
    parts.push(currency.format(candidate.totalAmount));
  }

  if (candidate.timeSpanSeconds !== undefined && candidate.timeSpanSeconds > 0) {
    parts.push(formatDuration(candidate.timeSpanSeconds));
  }

  if (m.retention !== undefined) {
    parts.push(`${(Number(m.retention) * 100).toFixed(1)}% retained`);
  } else if (m.overall_retention_ratio !== undefined) {
    parts.push(`${(Number(m.overall_retention_ratio) * 100).toFixed(1)}% retained`);
  } else if (m.amount_conservation_ratio !== undefined) {
    parts.push(`${(Number(m.amount_conservation_ratio) * 100).toFixed(1)}% conserved`);
  } else if (m.density !== undefined) {
    parts.push(`${(Number(m.density) * 100).toFixed(0)}% density`);
  } else if (m.inflow_outflow_ratio !== undefined) {
    parts.push(`${Number(m.inflow_outflow_ratio).toFixed(2)}x flow ratio`);
  }

  if (m.structuring_share !== undefined && Number(m.structuring_share) > 0) {
    parts.push(`${(Number(m.structuring_share) * 100).toFixed(0)}% structuring`);
  }

  if (m.log_degree_z_score !== undefined) {
    parts.push(`${Number(m.log_degree_z_score).toFixed(1)}σ z-score`);
  } else if (m.internal_transaction_count !== undefined) {
    parts.push(`${m.internal_transaction_count} internal txs`);
  } else if (m.observed_pairs !== undefined) {
    parts.push(`${m.observed_pairs} shared pairs`);
  }

  return parts.length > 0 ? parts.join(' · ') : `${candidate.transactions.length} transfers`;
}

export function cycleToWorkbenchCandidate(hit: CycleCandidate): WorkbenchCandidate {
  const totalAmount = hit.total_flow ?? hit.total_amount ?? 0;
  const duration = hit.duration_seconds ?? hit.time_span ?? 0;

  const candidate: WorkbenchCandidate = {
    id: hit.cycle_id,
    pattern: 'cycle',
    accounts: hit.accounts,
    transactions: hit.transactions.map((tx): DetectorTransaction => ({
      tx_id: tx.tx_id,
      src: tx.src,
      dst: tx.dst,
      amount: tx.amount,
      ts: tx.ts,
      step: tx.step,
      tx_type: tx.tx_type,
    })),
    measurements: {
      cycle_length: hit.cycle_length,
      duration_seconds: duration,
      retention: hit.retention,
      amount_conservation_ratio: hit.amount_conservation_ratio,
      total_amount: totalAmount,
    },
    suspicious: Boolean(hit.suspicious),
    explanation: hit.explanation,
    primaryLabel: `${hit.cycle_length}-Hop Circular Flow`,
    totalAmount,
    timeSpanSeconds: duration,
  };

  return candidate;
}

export function detectorHitToWorkbenchCandidate(hit: DetectorHit): WorkbenchCandidate {
  const m = hit.measurements || {};
  let totalAmount = 0;
  if (typeof m.total_amount === 'number') {
    totalAmount = m.total_amount;
  } else if (typeof m.total_outflow === 'number') {
    totalAmount = m.total_outflow;
  } else if (typeof m.inflow_amount === 'number') {
    totalAmount = m.inflow_amount;
  } else if (typeof m.initial_amount === 'number') {
    totalAmount = m.initial_amount;
  } else if (Array.isArray(hit.transactions) && hit.transactions.length > 0) {
    totalAmount = hit.transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
  }

  let duration: number | undefined;
  if (typeof m.time_window_seconds === 'number') duration = m.time_window_seconds;
  else if (typeof m.duration_seconds === 'number') duration = m.duration_seconds;

  // Ensure accounts array has all interacting accounts (essential for Cytoscape node rendering)
  let accounts = Array.isArray(hit.account_ids) ? [...hit.account_ids] : [];
  if (Array.isArray(m.counterparty_ids)) {
    const cpSet = new Set(accounts);
    for (const cp of m.counterparty_ids as string[]) {
      cpSet.add(cp);
    }
    accounts = Array.from(cpSet);
  } else if (Array.isArray(hit.transactions)) {
    const txSet = new Set(accounts);
    for (const tx of hit.transactions) {
      if (tx.src) txSet.add(tx.src);
      if (tx.dst) txSet.add(tx.dst);
    }
    accounts = Array.from(txSet);
  }

  const candidate: WorkbenchCandidate = {
    id: hit.hit_id,
    pattern: hit.pattern,
    accounts,
    transactions: hit.transactions || [],
    measurements: hit.measurements || {},
    suspicious: Boolean(m.suspicious),
    explanation: hit.explanation,
    primaryLabel: '',
    totalAmount,
    timeSpanSeconds: duration,
  };

  candidate.primaryLabel = getCandidateHumanTitle(candidate);
  return candidate;
}

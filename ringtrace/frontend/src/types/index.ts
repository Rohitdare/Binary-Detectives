export type PageTab = 'overview' | 'explorer' | 'investigations' | 'patterns' | 'evidence' | 'settings';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'error';
  falkordb_connected: boolean;
  graph: string;
  host: string;
  port: number;
  error?: string;
}

export interface SystemStats {
  total_accounts: number;
  total_transactions: number;
  active_investigations: number;
  investigation_status: string;
  suspicious_patterns_detected: string;
  detection_engine_status: string;
  graph_name: string;
}

export interface TransactionRecord {
  tx_id: string;
  src: string;
  dst: string;
  amount: number;
  ts: number;
  step: number;
  tx_type: string;
}

export interface GraphNodeData {
  id: string;
  label: string;
  type: 'personal' | 'merchant' | 'payroll' | string;
  community: number;
}

export interface GraphEdgeData {
  id: string;
  source: string;
  target: string;
  amount: number;
  ts: number;
  tx_type: string;
}

export interface NetworkGraphData {
  nodes: Array<{ data: GraphNodeData }>;
  edges: Array<{ data: GraphEdgeData }>;
  total_nodes: number;
  total_edges: number;
}

export interface AccountData {
  id: string;
  type: string;
  community: number;
  created: string;
}

export interface AccountDetailsResponse {
  account: AccountData;
  outgoing: TransactionRecord[];
  incoming: TransactionRecord[];
  out_count: number;
  in_count: number;
  total_sent_sample: number;
  total_received_sample: number;
}

export interface SearchResultAccount {
  id: string;
  type: string;
  community: number;
}

export interface CycleTransaction {
  tx_id: string;
  src: string;
  dst: string;
  amount: number;
  ts: number;
  step: number;
  tx_type: string;
}

export interface CycleCandidate {
  cycle_id: string;
  pattern_type: 'cycle' | string;
  candidate_type: 'cycle_candidate' | string;
  cycle_length: number;
  canonical_edge_sequence?: string[];
  accounts: string[];
  transactions: CycleTransaction[];
  all_supporting_transactions?: CycleTransaction[];
  total_flow: number;
  total_amount: number;
  time_span: number;
  duration_seconds: number;
  retention: number;
  min_amount: number;
  max_amount: number;
  amount_conservation_ratio: number;
  first_transaction_ts: number;
  last_transaction_ts: number;
  is_time_ordered: boolean;
  suspicious?: boolean;
  explanation: string;
}

export type DetectorPattern = 'cycle' | 'fan_in' | 'fan_out';

export interface DetectorTransaction {
  tx_id: string;
  src: string;
  dst: string;
  amount: number;
  ts: number;
  step?: number;
  tx_type: string;
}

export interface DetectorHit {
  hit_id: string;
  pattern: DetectorPattern;
  account_ids: string[];
  tx_ids: string[];
  transactions: DetectorTransaction[];
  measurements: Record<string, number | string | boolean | null>;
  explanation: string;
}

export interface DetectorRunSummary {
  status: 'ready' | 'running' | 'completed' | 'failed';
  hits: number;
  suspicious: number;
  execution_time_ms?: number;
  edges_scanned?: number;
  search_steps?: number;
  truncated?: boolean;
  error?: string;
}

export interface DetectorRunResponse {
  status: string;
  pattern: DetectorPattern | 'cycle';
  count: number;
  suspicious_count: number;
  truncated: boolean;
  truncation_reason: string | null;
  execution_time_ms: number;
  edges_scanned?: number;
  search_steps?: number;
  hits?: DetectorHit[];
  cycles?: CycleCandidate[];
}

export interface CycleDetectionResponse {
  status: string;
  graph: string;
  min_length: number;
  max_length: number;
  limit: number;
  count: number;
  truncated: boolean;
  truncation_reason: string | null;
  suspicious_count?: number;
  edges_scanned?: number;
  search_steps?: number;
  execution_time_ms?: number;
  cycles: CycleCandidate[];
}

export interface CycleEvaluationReport {
  status: string;
  timestamp: string;
  evaluation_config: {
    graph: string;
    configured_limit: number;
    data_source: string;
    execution_time_ms: number;
  };
  ground_truth_summary: {
    planted_fraud_cycle_alerts: number;
    planted_benign_look_alikes: number;
    benign_breakdown: {
      slow_family_cycle: number;
      unordered_cycle: number;
    };
  };
  detection_summary: {
    candidates_returned: number;
    truncated: boolean;
    truncation_reason: string | null;
  };
  matching_results: {
    exact_matches_count: number;
    exact_matches: Array<{
      alert_id: string;
      candidate_id: string;
      accounts: string[];
      length: number;
    }>;
    partial_matches_count: number;
    partial_matches: Array<{
      alert_id: string;
      candidate_id: string;
      accounts: string[];
      overlap_pct: number;
      length: number;
    }>;
    unmatched_planted_count: number;
    unmatched_planted_alerts: Array<{
      alert_id: string;
      reason: string;
      length: number;
      accounts: string[];
    }>;
    benign_false_positives: Record<string, number>;
    unlabeled_candidates_count: number;
  };
  metrics: {
    exact_recall: number;
    total_recall: number;
    precision: number;
  };
}



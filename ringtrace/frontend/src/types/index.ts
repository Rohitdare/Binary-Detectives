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
  accounts: string[];
  transactions: CycleTransaction[];
  all_supporting_transactions?: CycleTransaction[];
  total_amount: number;
  min_amount: number;
  max_amount: number;
  amount_conservation_ratio: number;
  first_transaction_ts: number;
  last_transaction_ts: number;
  duration_seconds: number;
  is_time_ordered: boolean;
  explanation: string;
}

export interface CycleDetectionResponse {
  status: string;
  graph: string;
  min_length: number;
  max_length: number;
  count: number;
  cycles: CycleCandidate[];
}


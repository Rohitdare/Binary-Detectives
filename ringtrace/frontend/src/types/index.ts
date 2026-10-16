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

export interface InvestigationStep {
  step?: number;
  index?: number;
  tool: string;
  args: Record<string, any>;
  summary: string;
  evidence: {
    account_ids: string[];
    tx_ids: string[];
  };
}

export interface Finding {
  id?: string;
  text: string;
  evidence_ids?: string[];
}

export interface SimilarCaseCitation {
  case_id: string;
  outcome?: string;
  reason?: string;
}

export interface InvestigationAssessment {
  risk_level: 'low' | 'medium' | 'high';
  summary: string;
  narrative: string;
  findings: Finding[];
  similar_cases: SimilarCaseCitation[];
}

export interface ProposedAction {
  action_id: string;
  case_id?: string;
  type: 'escalate' | 'monitor' | 'dismiss' | 'draft_sar';
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at?: string;
}

export interface InvestigationResult {
  investigation_id: string;
  case_id: string;
  status: 'running' | 'done' | 'error';
  mode: 'llm' | 'fallback';
  steps: InvestigationStep[];
  assessment?: InvestigationAssessment | null;
  proposed_action?: ProposedAction | null;
  error?: string | null;
  created_at?: string;
}

export interface DecisionRecord {
  decision_id: string;
  case_id: string;
  decision: 'escalate' | 'monitor' | 'dismiss';
  note: string;
  actor: string;
  ts: string;
}

export interface SimilarCaseItem {
  case_id: string;
  match: string;
  shared_account_ids: string[];
  outcome: string | null;
  decided_at?: string | null;
  score?: number | null;
  patterns?: string[];
}

export interface SimilarCasesResponse {
  items: SimilarCaseItem[];
  next_cursor?: string | null;
}

export interface StreamStatus {
  state: 'idle' | 'running' | 'paused' | 'stopped';
  sent: number;
  total: number;
  batch_size: number;
  current_index?: number;
}

export interface DemoResetResponse {
  status: string;
  removed_demo_accounts: number;
  removed_demo_edges: number;
  memory_cleared: boolean;
  replay_reset: boolean;
  reseeded: boolean;
  cases_seeded: number;
}



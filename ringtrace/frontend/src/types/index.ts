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

export type DetectorPattern =
  | 'cycle'
  | 'fan_in'
  | 'fan_out'
  | 'relay_chain'
  | 'scatter_gather'
  | 'gather_scatter'
  | 'bipartite'
  | 'dense_cluster'
  | 'hub_account';

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
  truncation_reasons?: string[];
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

export interface CaseScoreBreakdown {
  severity: number;
  amount: number;
  velocity: number;
  account_count: number;
  corroboration: number;
  total: number;
  origin_context_adjustment?: number;
  total_amount?: number;
  duration_seconds?: number;
  severity_label?: string;
}

export interface CaseRecord {
  case_id: string;
  status: string;
  severity: 'low' | 'medium' | 'high' | string;
  score: number;
  patterns: string[];
  account_count: number;
  tx_count: number;
  total_amount: number;
  first_ts?: string | null;
  last_ts?: string | null;
  similar_case_count?: number;
  updated_at: string;
  score_breakdown?: CaseScoreBreakdown | null;
}

export interface CaseHit {
  hit_id: string;
  pattern: string;
  account_ids: string[];
  tx_ids: string[];
  measurements: Record<string, any>;
  explanation: string;
  transactions?: TransactionRecord[];
  account_roles?: Record<string, string>;
}

export interface CaseTransaction {
  tx_id: string;
  src: string;
  dst: string;
  amount: number;
  ts: string | number;
  tx_type?: string;
}

export interface CaseDecision {
  decision_id: string;
  case_id?: string;
  decision: string;
  note: string;
  actor: string;
  ts: string;
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

export interface CaseDetail extends CaseRecord {
  hits: CaseHit[];
  transactions: CaseTransaction[];
  decisions: CaseDecision[];
}

export interface CaseListResponse {
  items: CaseRecord[];
  next_cursor: string | null;
}

export interface CaseGraphNode {
  id: string;
  type: string;
  roles: string[];
  in_case: boolean;
}

export interface CaseGraphEdge {
  tx_id: string;
  source: string;
  target: string;
  amount: number;
  ts: string | number;
}

export interface CaseGraphData {
  nodes: CaseGraphNode[];
  edges: CaseGraphEdge[];
}

export interface ScanReceipt {
  scan_id: string;
  status: string;
}

export interface ScanStatus {
  scan_id: string;
  status: string;
  graph?: string;
  detector_reports?: Record<string, any>;
  detector_errors?: Record<string, string>;
  hit_count?: number;
  case_count?: number;
  limitations?: string[];
  skipped_non_case_generating_hit_ids?: string[];
  skipped_oversized_hit_ids?: string[];
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



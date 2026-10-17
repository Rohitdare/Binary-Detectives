import type {
  AccountDetailsResponse,
  HealthStatus,
  NetworkGraphData,
  SearchResultAccount,
  SystemStats,
  TransactionRecord,
  DetectorRunResponse,
  CaseDetail,
  CaseListResponse,
  CaseGraphData,
  ScanReceipt,
  ScanStatus,
} from '../types';

const API_BASE = '/api';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}: ${res.statusText}`;
    let errorData: any = null;
    try {
      const err = await res.json();
      errorData = err;
      if (err.error?.message) {
        msg = err.error.message;
      } else if (err.detail) {
        msg = err.detail;
      }
    } catch {
      // ignore json parse error
    }
    const error: any = new Error(msg);
    error.status = res.status;
    error.data = errorData;
    throw error;
  }
  return res.json();
}

export const ringtraceApi = {
  async getHealth(): Promise<HealthStatus> {
    const res = await fetch(`${API_BASE}/health`);
    return handleResponse<HealthStatus>(res);
  },

  async getStats(): Promise<SystemStats> {
    const res = await fetch(`${API_BASE}/stats`);
    return handleResponse<SystemStats>(res);
  },

  async getTransactions(limit = 50): Promise<TransactionRecord[]> {
    const res = await fetch(`${API_BASE}/transactions?limit=${limit}`);
    return handleResponse<TransactionRecord[]>(res);
  },

  async getGraph(limit = 80): Promise<NetworkGraphData> {
    const res = await fetch(`${API_BASE}/graph?limit=${limit}`);
    return handleResponse<NetworkGraphData>(res);
  },

  async getAccountDetails(accountId: string, limit = 25): Promise<AccountDetailsResponse> {
    const res = await fetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}?limit=${limit}`);
    return handleResponse<AccountDetailsResponse>(res);
  },

  async searchAccounts(query: string, limit = 8): Promise<SearchResultAccount[]> {
    const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    return handleResponse<SearchResultAccount[]>(res);
  },

  async detectCycles(minLength = 3, maxLength = 5, limit = 50): Promise<import('../types').CycleDetectionResponse> {
    const res = await fetch(
      `${API_BASE}/v1/detectors/cycles?min_length=${minLength}&max_length=${maxLength}&limit=${limit}`
    );
    return handleResponse<import('../types').CycleDetectionResponse>(res);
  },

  async detectFanIn(minSenders = 8, windowHours = 48, limit = 50): Promise<DetectorRunResponse> {
    const res = await fetch(
      `${API_BASE}/v1/detectors/fan-in?min_senders=${minSenders}&window_hours=${windowHours}&limit=${limit}`
    );
    return handleResponse<DetectorRunResponse>(res);
  },

  async detectFanOut(minReceivers = 8, windowHours = 48, limit = 50): Promise<DetectorRunResponse> {
    const res = await fetch(
      `${API_BASE}/v1/detectors/fan-out?min_receivers=${minReceivers}&window_hours=${windowHours}&limit=${limit}`
    );
    return handleResponse<DetectorRunResponse>(res);
  },

  async detectRelayChain(minHops = 3, maxHops = 6, maxGapHours = 6, observationHours = 24, limit = 50): Promise<DetectorRunResponse> {
    const res = await fetch(
      `${API_BASE}/v1/detectors/relay-chain?min_hops=${minHops}&max_hops=${maxHops}&max_gap_hours=${maxGapHours}&observation_hours=${observationHours}&limit=${limit}`
    );
    return handleResponse<DetectorRunResponse>(res);
  },

  async detectScatterGather(minIntermediaries = 3, maxPathGapHours = 24, limit = 50): Promise<DetectorRunResponse> {
    const res = await fetch(
      `${API_BASE}/v1/detectors/scatter-gather?min_intermediaries=${minIntermediaries}&max_path_gap_hours=${maxPathGapHours}&limit=${limit}`
    );
    return handleResponse<DetectorRunResponse>(res);
  },

  async detectGatherScatter(minIncoming = 3, minOutgoing = 3, windowHours = 48, limit = 50): Promise<DetectorRunResponse> {
    const res = await fetch(
      `${API_BASE}/v1/detectors/gather-scatter?min_incoming_counterparties=${minIncoming}&min_outgoing_counterparties=${minOutgoing}&window_hours=${windowHours}&limit=${limit}`
    );
    return handleResponse<DetectorRunResponse>(res);
  },

  async detectBipartite(minSources = 3, minTargets = 3, limit = 50): Promise<DetectorRunResponse> {
    const res = await fetch(
      `${API_BASE}/v1/detectors/bipartite?min_sources=${minSources}&min_targets=${minTargets}&limit=${limit}`
    );
    return handleResponse<DetectorRunResponse>(res);
  },

  async detectDenseCluster(minAccounts = 5, minimumDensity = 0.1, limit = 50): Promise<DetectorRunResponse> {
    const res = await fetch(
      `${API_BASE}/v1/detectors/dense-cluster?min_accounts=${minAccounts}&minimum_density=${minimumDensity}&limit=${limit}`
    );
    return handleResponse<DetectorRunResponse>(res);
  },

  async detectHubAccount(minimumCounterparties = 10, minimumZScore = 3.0, limit = 50): Promise<DetectorRunResponse> {
    const res = await fetch(
      `${API_BASE}/v1/detectors/hub-account?minimum_counterparties=${minimumCounterparties}&minimum_z_score=${minimumZScore}&limit=${limit}`
    );
    return handleResponse<DetectorRunResponse>(res);
  },

  async evaluateCycles(limit = 50): Promise<import('../types').CycleEvaluationReport> {
    const res = await fetch(`${API_BASE}/evaluate/cycles?limit=${limit}`);
    return handleResponse<import('../types').CycleEvaluationReport>(res);
  },

  async evaluateGraphPatterns(limit = 50): Promise<any> {
    const res = await fetch(`${API_BASE}/v1/evaluate/graph-patterns?limit=${limit}`);
    return handleResponse<any>(res);
  },

  async getCases(params: {
    status?: string;
    pattern?: string;
    severity?: string;
    sort?: string;
    limit?: number;
    cursor?: string | null;
  } = {}): Promise<CaseListResponse> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.pattern) query.set('pattern', params.pattern);
    if (params.severity) query.set('severity', params.severity);
    if (params.sort) query.set('sort', params.sort);
    if (params.limit) query.set('limit', String(params.limit));
    if (params.cursor) query.set('cursor', params.cursor);
    const qs = query.toString();
    const res = await fetch(`${API_BASE}/v1/cases${qs ? `?${qs}` : ''}`);
    return handleResponse<CaseListResponse>(res);
  },

  async getCase(caseId: string): Promise<CaseDetail> {
    const res = await fetch(`${API_BASE}/v1/cases/${encodeURIComponent(caseId)}`);
    return handleResponse<CaseDetail>(res);
  },

  async getCaseGraph(caseId: string): Promise<CaseGraphData> {
    const res = await fetch(`${API_BASE}/v1/cases/${encodeURIComponent(caseId)}/graph`);
    return handleResponse<CaseGraphData>(res);
  },

  async startScan(): Promise<ScanReceipt> {
    const res = await fetch(`${API_BASE}/v1/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse<ScanReceipt>(res);
  },

  async getScanStatus(scanId: string): Promise<ScanStatus> {
    const res = await fetch(`${API_BASE}/v1/scan/${encodeURIComponent(scanId)}`);
    return handleResponse<ScanStatus>(res);
  },

  async getGraphSummary(): Promise<any> {
    const res = await fetch(`${API_BASE}/v1/graph/summary`);
    return handleResponse<any>(res);
  },
};


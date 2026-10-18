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
  SchedulerStatus,
} from '../types';
const RAW_API_BASE = (import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export const API_BASE = RAW_API_BASE.endsWith('/api')
  ? RAW_API_BASE
  : `${RAW_API_BASE}/api`.replace(/^\/api\/api$/, '/api');

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}: ${res.statusText}`;
    let errorData: any = null;
    try {
      const err = await res.json();
      errorData = err;
      if (err?.error?.message && typeof err.error.message === 'string') {
        msg = err.error.message;
      } else if (err?.detail?.error?.message && typeof err.detail.error.message === 'string') {
        msg = err.detail.error.message;
      } else if (typeof err?.detail === 'string') {
        msg = err.detail;
      } else if (Array.isArray(err?.detail)) {
        msg = err.detail.map((d: any) => d?.msg || JSON.stringify(d)).join(', ');
      } else if (err?.message && typeof err.message === 'string') {
        msg = err.message;
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

  async getLatestEvaluation(): Promise<import('../types').EvaluationResponse> {
    const res = await fetch(`${API_BASE}/v1/evaluation`);
    return handleResponse<import('../types').EvaluationResponse>(res);
  },

  async runEvaluationBenchmark(): Promise<{ evaluation_id: string; status: string }> {
    const res = await fetch(`${API_BASE}/v1/evaluation/run`, { method: 'POST' });
    return handleResponse<{ evaluation_id: string; status: string }>(res);
  },

  async getEvaluationStatus(evaluationId: string): Promise<import('../types').EvaluationResponse & { evaluation_id: string }> {
    const res = await fetch(`${API_BASE}/v1/evaluation/${evaluationId}`);
    return handleResponse<import('../types').EvaluationResponse & { evaluation_id: string }>(res);
  },

  async evaluateAllDetectors(limit = 50): Promise<import('../types').EvaluationResponse> {
    const res = await fetch(`${API_BASE}/v1/evaluate/all?limit=${limit}`);
    return handleResponse<import('../types').EvaluationResponse>(res);
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

  async getSchedulerStatus(): Promise<SchedulerStatus> {
    const res = await fetch(`${API_BASE}/v1/scheduler/status`);
    return handleResponse<SchedulerStatus>(res);
  },

  async pauseScheduler(): Promise<SchedulerStatus> {
    const res = await fetch(`${API_BASE}/v1/scheduler/pause`, { method: 'POST' });
    return handleResponse<SchedulerStatus>(res);
  },

  async resumeScheduler(): Promise<SchedulerStatus> {
    const res = await fetch(`${API_BASE}/v1/scheduler/resume`, { method: 'POST' });
    return handleResponse<SchedulerStatus>(res);
  },

  async getLatestScan(): Promise<ScanStatus> {
    const res = await fetch(`${API_BASE}/v1/scans/latest`);
    return handleResponse<ScanStatus>(res);
  },

  async getGraphSummary(): Promise<any> {
    const res = await fetch(`${API_BASE}/v1/graph/summary`);
    return handleResponse<any>(res);
  },

  // --- Member B: Investigation & Memory Endpoints (/api/v1) ---
  async startInvestigation(caseId: string): Promise<{ investigation_id: string; status: string }> {
    const res = await fetch(`${API_BASE}/v1/cases/${encodeURIComponent(caseId)}/investigations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse<{ investigation_id: string; status: string }>(res);
  },

  async getInvestigation(investigationId: string): Promise<import('../types').InvestigationResult> {
    const res = await fetch(`${API_BASE}/v1/investigations/${encodeURIComponent(investigationId)}`);
    return handleResponse<import('../types').InvestigationResult>(res);
  },

  async getCaseInvestigations(caseId: string): Promise<{ items: import('../types').InvestigationResult[]; total: number }> {
    const res = await fetch(`${API_BASE}/v1/cases/${encodeURIComponent(caseId)}/investigations`);
    return handleResponse<{ items: import('../types').InvestigationResult[]; total: number }>(res);
  },

  async getSimilarCases(caseId: string, limit = 5): Promise<import('../types').SimilarCasesResponse> {
    const res = await fetch(`${API_BASE}/v1/cases/${encodeURIComponent(caseId)}/similar?limit=${limit}`);
    return handleResponse<import('../types').SimilarCasesResponse>(res);
  },

  async recordDecision(
    caseId: string,
    decision: 'escalate' | 'monitor' | 'dismiss',
    note: string,
    actor = 'analyst_1'
  ): Promise<import('../types').DecisionRecord> {
    const res = await fetch(`${API_BASE}/v1/cases/${encodeURIComponent(caseId)}/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, note, actor }),
    });
    return handleResponse<import('../types').DecisionRecord>(res);
  },

  async getCaseDecisions(caseId: string): Promise<{ items: import('../types').DecisionRecord[]; total: number }> {
    const res = await fetch(`${API_BASE}/v1/cases/${encodeURIComponent(caseId)}/decisions`);
    return handleResponse<{ items: import('../types').DecisionRecord[]; total: number }>(res);
  },

  async askCase(
    caseId: string,
    message: string,
    history: import('../types').CaseChatMessage[] = []
  ): Promise<import('../types').CaseChatResponse> {
    const res = await fetch(`${API_BASE}/v1/cases/${encodeURIComponent(caseId)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    });
    return handleResponse<import('../types').CaseChatResponse>(res);
  },

  async getCaseSar(caseId: string): Promise<import('../types').SarDraft> {
    const res = await fetch(`${API_BASE}/v1/cases/${encodeURIComponent(caseId)}/sar`);
    return handleResponse<import('../types').SarDraft>(res);
  },

  async generateCaseSar(caseId: string, regenerate = false): Promise<import('../types').SarDraft> {
    const query = regenerate ? '?regenerate=true' : '';
    const res = await fetch(`${API_BASE}/v1/cases/${encodeURIComponent(caseId)}/sar/generate${query}`, {
      method: 'POST',
    });
    return handleResponse<import('../types').SarDraft>(res);
  },

  async approveAction(actionId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/v1/actions/${encodeURIComponent(actionId)}/approve`, {
      method: 'POST',
    });
    return handleResponse<any>(res);
  },

  async rejectAction(actionId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/v1/actions/${encodeURIComponent(actionId)}/reject`, {
      method: 'POST',
    });
    return handleResponse<any>(res);
  },

  // --- Member B: Stream Replay & Demo Reset ---
  async getStreamStatus(): Promise<import('../types').StreamStatus> {
    const res = await fetch(`${API_BASE}/v1/stream/status`);
    return handleResponse<import('../types').StreamStatus>(res);
  },

  async startStream(batchSize = 50, intervalSeconds = 1.0): Promise<import('../types').StreamStatus> {
    const res = await fetch(`${API_BASE}/v1/stream/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch_size: batchSize, interval_seconds: intervalSeconds }),
    });
    return handleResponse<import('../types').StreamStatus>(res);
  },

  async pauseStream(): Promise<import('../types').StreamStatus> {
    const res = await fetch(`${API_BASE}/v1/stream/pause`, { method: 'POST' });
    return handleResponse<import('../types').StreamStatus>(res);
  },

  async resumeStream(): Promise<import('../types').StreamStatus> {
    const res = await fetch(`${API_BASE}/v1/stream/resume`, { method: 'POST' });
    return handleResponse<import('../types').StreamStatus>(res);
  },

  async stopStream(): Promise<import('../types').StreamStatus> {
    const res = await fetch(`${API_BASE}/v1/stream/stop`, { method: 'POST' });
    return handleResponse<import('../types').StreamStatus>(res);
  },

  async resetDemo(): Promise<import('../types').DemoResetResponse> {
    const res = await fetch(`${API_BASE}/v1/demo/reset`, { method: 'POST' });
    return handleResponse<import('../types').DemoResetResponse>(res);
  },
};

export const api = ringtraceApi;


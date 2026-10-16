import type {
  AccountDetailsResponse,
  HealthStatus,
  NetworkGraphData,
  SearchResultAccount,
  SystemStats,
  TransactionRecord,
} from '../types';

const API_BASE = '/api';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const err = await res.json();
      if (err.detail) msg = err.detail;
    } catch {
      // ignore json parse error
    }
    throw new Error(msg);
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
      `${API_BASE}/detectors/cycles?min_length=${minLength}&max_length=${maxLength}&limit=${limit}`
    );
    return handleResponse<import('../types').CycleDetectionResponse>(res);
  },

  // --- Member B: Investigation & Memory Endpoints (/api/v1) ---
  async startInvestigation(caseId: string): Promise<{ investigation_id: string; status: string }> {
    const res = await fetch(`/api/v1/cases/${encodeURIComponent(caseId)}/investigations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse<{ investigation_id: string; status: string }>(res);
  },

  async getInvestigation(investigationId: string): Promise<import('../types').InvestigationResult> {
    const res = await fetch(`/api/v1/investigations/${encodeURIComponent(investigationId)}`);
    return handleResponse<import('../types').InvestigationResult>(res);
  },

  async getCaseInvestigations(caseId: string): Promise<{ items: import('../types').InvestigationResult[]; total: number }> {
    const res = await fetch(`/api/v1/cases/${encodeURIComponent(caseId)}/investigations`);
    return handleResponse<{ items: import('../types').InvestigationResult[]; total: number }>(res);
  },

  async getSimilarCases(caseId: string, limit = 5): Promise<import('../types').SimilarCasesResponse> {
    const res = await fetch(`/api/v1/cases/${encodeURIComponent(caseId)}/similar?limit=${limit}`);
    return handleResponse<import('../types').SimilarCasesResponse>(res);
  },

  async recordDecision(
    caseId: string,
    decision: 'escalate' | 'monitor' | 'dismiss',
    note: string,
    actor = 'analyst_1'
  ): Promise<import('../types').DecisionRecord> {
    const res = await fetch(`/api/v1/cases/${encodeURIComponent(caseId)}/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, note, actor }),
    });
    return handleResponse<import('../types').DecisionRecord>(res);
  },

  async getCaseDecisions(caseId: string): Promise<{ items: import('../types').DecisionRecord[]; total: number }> {
    const res = await fetch(`/api/v1/cases/${encodeURIComponent(caseId)}/decisions`);
    return handleResponse<{ items: import('../types').DecisionRecord[]; total: number }>(res);
  },

  async approveAction(actionId: string): Promise<any> {
    const res = await fetch(`/api/v1/actions/${encodeURIComponent(actionId)}/approve`, {
      method: 'POST',
    });
    return handleResponse<any>(res);
  },

  async rejectAction(actionId: string): Promise<any> {
    const res = await fetch(`/api/v1/actions/${encodeURIComponent(actionId)}/reject`, {
      method: 'POST',
    });
    return handleResponse<any>(res);
  },
};


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
};

import type { EmailDetail, EmailFilters, EmailListItem, GraphEdge, GraphNode, Health } from './types.js';

/**
 * Thin API client.
 *
 * Its one real job is turning the server's `{ error: { code, message } }`
 * envelope into a thrown `ApiClientError` carrying a message worth showing a
 * user — so no component has to unpack an error body, and no error state ever
 * renders "[object Object]".
 */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

async function toError(response: Response): Promise<ApiClientError> {
  let body: ErrorEnvelope = {};
  try {
    body = (await response.json()) as ErrorEnvelope;
  } catch {
    // Non-JSON error body (a proxy failure, say) — fall through to the default.
  }

  return new ApiClientError(
    body.error?.message ?? `Request failed with status ${response.status}.`,
    body.error?.code ?? 'unknown',
    response.status,
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    // fetch only rejects on network failure, which for this app means the API
    // is not running — worth saying plainly rather than "Failed to fetch".
    throw new ApiClientError(
      'Could not reach the API. Is the server running?',
      'network_error',
      0,
    );
  }

  if (!response.ok) throw await toError(response);
  return (await response.json()) as T;
}

const buildQuery = (filters: EmailFilters): string => {
  const params = new URLSearchParams();
  if (filters.minRisk) params.set('minRisk', filters.minRisk);
  if (filters.status) params.set('status', filters.status);
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  const query = params.toString();
  return query ? `?${query}` : '';
};

export const api = {
  health: (): Promise<Health> => request<Health>('/api/health'),

  listEmails: (filters: EmailFilters = {}): Promise<{ emails: EmailListItem[]; total: number }> =>
    request(`/api/emails${buildQuery(filters)}`),

  getEmail: (id: string): Promise<EmailDetail> => request(`/api/emails/${id}`),

  createFromText: (text: string): Promise<EmailDetail> =>
    request('/api/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    }),

  createFromFile: (file: File): Promise<EmailDetail> => {
    const form = new FormData();
    form.append('file', file);
    return request('/api/emails', { method: 'POST', body: form });
  },

  reprocess: (id: string): Promise<EmailDetail> =>
    request(`/api/emails/${id}/reprocess`, { method: 'POST' }),

  graph: (minRisk?: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> =>
    request(`/api/graph${minRisk ? `?minRisk=${minRisk}` : ''}`),
};

export { buildQuery };

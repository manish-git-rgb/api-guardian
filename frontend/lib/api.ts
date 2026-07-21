const API_BASE = "http://127.0.0.1:8000/api";
const TOKEN_KEY = "api_guardian_token";

export type Project = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

export type SpecVersion = {
  id: string;
  version_label: string;
};

export type Change = {
  path: string;
  method: string | null;
  change_type: string;
  severity: "safe" | "medium" | "high" | "critical";
  field: string | null;
  old_value: unknown;
  new_value: unknown;
  description: string;
  ai_explanation: string | null;
};

export type Comparison = {
  id: string;
  risk_score: string;
  created_at: string;
  changes: Change[];
};

export type AIReport = {
  report_type: "migration_guide" | "release_notes";
  content: string;
  created_at: string;
};

export type User = {
  id: string;
  email: string;
  auth_provider: string;
};

export type Token = {
  access_token: string;
  token_type: string;
};

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (res.status === 401) {
    // Token missing/expired/invalid — clear it so the app knows to show login again.
    clearToken();
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

export const api = {
  // Auth
  signup: (email: string, password: string) =>
    request<Token>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<Token>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<User>("/auth/me"),

  googleLoginUrl: () => `${API_BASE}/auth/google/login`,

  // Projects
  listProjects: () => request<Project[]>("/projects"),

  createProject: (data: { name: string; description?: string; repo_url?: string }) =>
    request<Project>("/projects", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  uploadVersion: (
    projectId: string,
    data: { version_label: string; format: "json" | "yaml"; raw_spec: string }
  ) =>
    request<SpecVersion>(`/projects/${projectId}/versions`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  listVersions: (projectId: string) =>
    request<SpecVersion[]>(`/projects/${projectId}/versions`),

  compareVersions: (projectId: string, fromVersionId: string, toVersionId: string) =>
    request<Comparison>(
      `/projects/${projectId}/compare?from_version_id=${fromVersionId}&to_version_id=${toVersionId}`,
      { method: "POST" }
    ),

  getComparison: (comparisonId: string) =>
    request<Comparison>(`/comparisons/${comparisonId}`),

  getAIReports: (comparisonId: string) =>
    request<AIReport[]>(`/comparisons/${comparisonId}/ai-reports`),

  deleteProject: (projectId: string) =>
    request<{ deleted: boolean }>(`/projects/${projectId}`, { method: "DELETE" }),

  deleteVersion: (projectId: string, versionId: string) =>
    request<{ deleted: boolean }>(`/projects/${projectId}/versions/${versionId}`, {
      method: "DELETE",
    }),

  deleteComparison: (comparisonId: string) =>
    request<{ deleted: boolean }>(`/comparisons/${comparisonId}`, { method: "DELETE" }),
};
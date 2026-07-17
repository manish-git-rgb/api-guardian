
const API_BASE = "http://127.0.0.1:8000/api";

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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

export const api = {
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

  compareVersions: (projectId: string, fromVersionId: string, toVersionId: string) =>
    request<Comparison>(
      `/projects/${projectId}/compare?from_version_id=${fromVersionId}&to_version_id=${toVersionId}`,
      { method: "POST" }
    ),
};
// frontend/app/page.tsx
"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ShieldCheck, Plus, UploadCloud, LogOut } from "lucide-react";
import { api, Project, Comparison, AIReport, clearToken, isLoggedIn } from "@/lib/api";

const body = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"] });

type LocalVersion = { id: string; label: string };

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 10;

const SEVERITY_BORDER: Record<string, string> = {
  critical: "border-l-red-500",
  high: "border-l-orange-500",
  medium: "border-l-yellow-500",
  safe: "border-l-emerald-500",
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400",
  high: "bg-orange-500/15 text-orange-400",
  medium: "bg-yellow-500/15 text-yellow-400",
  safe: "bg-emerald-500/15 text-emerald-400",
};

const RISK_BADGE: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
  high: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  safe: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

export default function Dashboard() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const [versions, setVersions] = useState<LocalVersion[]>([]);
  const [label, setLabel] = useState("");
  const [rawSpec, setRawSpec] = useState("");
  const [specFormat, setSpecFormat] = useState<"json" | "yaml">("json");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");

  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [aiReports, setAiReports] = useState<AIReport[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    async function checkAuth() {
      if (!isLoggedIn()) {
        router.replace("/login");
        return;
      }
      try {
        const user = await api.me();
        setUserEmail(user.email);
        setAuthChecked(true);
        refreshProjects();
      } catch {
        clearToken();
        router.replace("/login");
      }
    }
    checkAuth();
  }, [router]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function handleLogout() {
    clearToken();
    router.replace("/login");
  }

  async function refreshProjects() {
    try {
      setLoading(true);
      setProjects(await api.listProjects());
    } catch {
      setError("Could not reach the backend. Is uvicorn running on port 8000?");
    } finally {
      setLoading(false);
    }
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const project = await api.createProject({ name: newName, description: newDesc || undefined });
      setNewName("");
      setNewDesc("");
      await refreshProjects();
      setSelected(project);
      setVersions([]);
      setComparison(null);
      setAiReports([]);
      setAiLoading(false);
      setFromId("");
      setToId("");
    } catch {
      setError("Couldn't create the project.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteProject(p: Project, e: React.MouseEvent) {
    e.stopPropagation();
    const confirmed = window.confirm(
      `Delete project "${p.name}" and all its versions/comparisons? This can't be undone.`
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      await api.deleteProject(p.id);
      if (selected?.id === p.id) {
        setSelected(null);
        setVersions([]);
        setComparison(null);
        setAiReports([]);
      }
      await refreshProjects();
    } catch {
      setError("Couldn't delete the project.");
    } finally {
      setBusy(false);
    }
  }

  function handleFileChosen(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "yml" || ext === "yaml") setSpecFormat("yaml");
    else setSpecFormat("json");
    const reader = new FileReader();
    reader.onload = () => setRawSpec(String(reader.result || ""));
    reader.readAsText(file);
  }

  async function uploadVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !label.trim() || !rawSpec.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const v = await api.uploadVersion(selected.id, {
        version_label: label,
        format: specFormat,
        raw_spec: rawSpec,
      });
      setVersions((prev) => [...prev, { id: v.id, label: v.version_label }]);
      setLabel("");
      setRawSpec("");
    } catch {
      setError(`Couldn't parse that spec — check it's valid OpenAPI ${specFormat.toUpperCase()}.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteVersion(v: LocalVersion) {
    if (!selected) return;
    const confirmed = window.confirm(`Delete version "${v.label}"?`);
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      await api.deleteVersion(selected.id, v.id);
      setVersions((prev) => prev.filter((x) => x.id !== v.id));
      if (fromId === v.id) setFromId("");
      if (toId === v.id) setToId("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't delete that version.";
      setError(message.includes("used in an existing comparison")
        ? "That version is still used in a comparison — delete the comparison first."
        : "Couldn't delete that version.");
    } finally {
      setBusy(false);
    }
  }

  function startPollingForAI(comparisonId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    setAiLoading(true);
    let attempts = 0;

    pollRef.current = setInterval(async () => {
      attempts += 1;
      try {
        const [freshComparison, reports] = await Promise.all([
          api.getComparison(comparisonId),
          api.getAIReports(comparisonId),
        ]);
        setComparison(freshComparison);
        setAiReports(reports);

        const allExplained =
          freshComparison.changes.length === 0 ||
          freshComparison.changes.every((c) => c.ai_explanation);
        const reportsReady = freshComparison.changes.length === 0 || reports.length > 0;

        if ((allExplained && reportsReady) || attempts >= POLL_MAX_ATTEMPTS) {
          if (pollRef.current) clearInterval(pollRef.current);
          setAiLoading(false);
        }
      } catch {
        if (attempts >= POLL_MAX_ATTEMPTS) {
          if (pollRef.current) clearInterval(pollRef.current);
          setAiLoading(false);
        }
      }
    }, POLL_INTERVAL_MS);
  }

  async function runCompare() {
    if (!selected || !fromId || !toId) return;
    setBusy(true);
    setError(null);
    setAiReports([]);
    try {
      const result = await api.compareVersions(selected.id, fromId, toId);
      setComparison(result);
      if (result.changes.length > 0) {
        startPollingForAI(result.id);
      }
    } catch {
      setError("Comparison failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteComparison() {
    if (!comparison) return;
    const confirmed = window.confirm("Delete this comparison and its AI explanations/reports?");
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      await api.deleteComparison(comparison.id);
      if (pollRef.current) clearInterval(pollRef.current);
      setComparison(null);
      setAiReports([]);
      setAiLoading(false);
    } catch {
      setError("Couldn't delete the comparison.");
    } finally {
      setBusy(false);
    }
  }

  async function selectProject(p: Project) {
    if (pollRef.current) clearInterval(pollRef.current);
    setSelected(p);
    setVersions([]);
    setComparison(null);
    setAiReports([]);
    setAiLoading(false);
    setFromId("");
    setToId("");
    try {
      const existing = await api.listVersions(p.id);
      setVersions(existing.map((v) => ({ id: v.id, label: v.version_label })));
    } catch {
      setError("Couldn't load existing versions for this project.");
    }
  }

  const fromLabel = versions.find((v) => v.id === fromId)?.label;
  const toLabel = versions.find((v) => v.id === toId)?.label;
  const criticalCount = comparison?.changes.filter((c) => c.severity === "critical" || c.severity === "high").length ?? 0;
  const safeCount = comparison?.changes.filter((c) => c.severity === "safe" || c.severity === "medium").length ?? 0;

  if (!authChecked) {
    return (
      <div className={`${body.className} min-h-screen bg-[#0A0B0D] text-neutral-500 flex items-center justify-center text-sm`}>
        Loading…
      </div>
    );
  }

  return (
    <div className={`${body.className} min-h-screen bg-[#0A0B0D] text-neutral-200`}>
      <div className="grid grid-cols-[260px_1fr] min-h-screen">
        {/* Sidebar */}
        <aside className="bg-[#0D0E10] border-r border-neutral-800/80 p-5 flex flex-col gap-5">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <ShieldCheck size={15} className="text-emerald-400" />
            </div>
            <span className="font-bold text-white text-sm">API Guardian</span>
          </div>

          <form onSubmit={createProject} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-400">New Project</span>
            </div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              className="bg-black/40 border border-neutral-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-600/60 transition placeholder:text-neutral-600"
            />
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              className="bg-black/40 border border-neutral-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-600/60 transition placeholder:text-neutral-600"
            />
            <button
              disabled={busy}
              className="flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-lg py-2 text-sm transition disabled:opacity-50"
            >
              <Plus size={14} /> Create
            </button>
          </form>

          <div className="h-px bg-neutral-800/80" />

          <div className="flex flex-col gap-1 flex-1 overflow-y-auto">
            {loading && <span className="text-sm text-neutral-500">Loading…</span>}
            {!loading && projects.length === 0 && (
              <span className="text-sm text-neutral-500">No projects yet.</span>
            )}
            {projects.map((p) => (
              <div
                key={p.id}
                onClick={() => selectProject(p)}
                className={`group flex flex-col gap-0.5 px-3 py-2.5 rounded-lg cursor-pointer transition ${
                  selected?.id === p.id
                    ? "bg-neutral-800/70 border-l-2 border-emerald-500"
                    : "hover:bg-neutral-900 border-l-2 border-transparent"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${selected?.id === p.id ? "text-white" : "text-neutral-300"}`}>
                    {p.name}
                  </span>
                  <button
                    onClick={(e) => handleDeleteProject(p, e)}
                    className="opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-red-400 transition text-xs"
                  >
                    ✕
                  </button>
                </div>
                {p.description && (
                  <span className="text-xs text-neutral-500 truncate">{p.description}</span>
                )}
              </div>
            ))}
          </div>

          <div className="h-px bg-neutral-800/80" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500 truncate">{userEmail}</span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-200 transition"
            >
              <LogOut size={13} /> Log out
            </button>
          </div>
        </aside>

        {/* Main panel */}
        <main className="p-8 overflow-y-auto">
          {error && (
            <div className="mb-6 px-4 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
              {error}
            </div>
          )}

          {!selected && (
            <div className="text-neutral-500 text-sm">
              Select or create a project to upload spec versions and compare them.
            </div>
          )}

          {selected && !comparison && (
            <div className="flex flex-col gap-6 max-w-3xl">
              <div>
                <h1 className="text-2xl font-bold text-white">{selected.name}</h1>
                <p className="text-sm text-neutral-500 mt-1">
                  Manage spec versions, upload new definitions, and compare changes across releases.
                </p>
              </div>

              {/* Upload card */}
              <div className="bg-[#111214] border border-neutral-800/80 rounded-2xl p-5 flex flex-col gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-white">Upload Spec Version</h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Add a new OpenAPI or schema definition to this project.
                  </p>
                </div>

                <form onSubmit={uploadVersion} className="flex flex-col gap-3">
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleFileChosen(file);
                    }}
                    className="border border-dashed border-neutral-700 rounded-xl py-8 flex flex-col items-center gap-2 cursor-pointer hover:border-emerald-600/50 hover:bg-emerald-500/5 transition"
                  >
                    <UploadCloud size={22} className="text-neutral-500" />
                    <span className="text-sm text-neutral-400">Drop spec file here</span>
                    <span className="text-xs text-neutral-600">or click to browse files</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,.yaml,.yml"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileChosen(file);
                      }}
                    />
                  </div>

                  {rawSpec && (
                    <span className="text-xs text-emerald-400">
                      File loaded ({rawSpec.length.toLocaleString()} characters) — or edit below.
                    </span>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-neutral-400">Version Label</label>
                      <input
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="v1.0.0"
                        className="bg-black/40 border border-neutral-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-600/60 transition placeholder:text-neutral-600"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-neutral-400">Format</label>
                      <select
                        value={specFormat}
                        onChange={(e) => setSpecFormat(e.target.value as "json" | "yaml")}
                        className="bg-black/40 border border-neutral-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-600/60 transition"
                      >
                        <option value="json">JSON</option>
                        <option value="yaml">YAML</option>
                      </select>
                    </div>
                  </div>

                  <textarea
                    value={rawSpec}
                    onChange={(e) => setRawSpec(e.target.value)}
                    placeholder={specFormat === "json" ? "…or paste OpenAPI spec as JSON here" : "…or paste OpenAPI spec as YAML here"}
                    rows={4}
                    className={`${mono.className} bg-black/40 border border-neutral-800 rounded-lg px-3 py-2 text-xs outline-none focus:border-emerald-600/60 transition resize-y placeholder:text-neutral-600`}
                  />

                  <button
                    disabled={busy}
                    className="self-start bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-lg px-5 py-2 text-sm transition disabled:opacity-50"
                  >
                    Upload
                  </button>
                </form>
              </div>

              {/* Versions card */}
              {versions.length > 0 && (
                <div className="bg-[#111214] border border-neutral-800/80 rounded-2xl p-5 flex flex-col gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-white">Versions</h2>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Uploaded specification history for this project.
                    </p>
                  </div>
                  <div className="flex flex-col divide-y divide-neutral-800/60">
                    {versions.map((v) => (
                      <div key={v.id} className="group flex items-center justify-between py-2.5">
                        <span className={`${mono.className} text-sm text-neutral-200`}>{v.label}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-neutral-500">Uploaded</span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 uppercase">
                            {specFormat}
                          </span>
                          <button
                            onClick={() => handleDeleteVersion(v)}
                            className="opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-red-400 transition text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Compare card */}
              {versions.length > 0 && (
                <div className="bg-[#111214] border border-neutral-800/80 rounded-2xl p-5 flex flex-col gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-white">Compare Versions</h2>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Select two versions to inspect breaking changes.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-neutral-400">Base Version</label>
                      <select
                        value={fromId}
                        onChange={(e) => setFromId(e.target.value)}
                        className="bg-black/40 border border-neutral-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-600/60 transition"
                      >
                        <option value="">Select…</option>
                        {versions.map((v) => (
                          <option key={v.id} value={v.id}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-neutral-400">Target Version</label>
                      <select
                        value={toId}
                        onChange={(e) => setToId(e.target.value)}
                        className="bg-black/40 border border-neutral-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-600/60 transition"
                      >
                        <option value="">Select…</option>
                        {versions.map((v) => (
                          <option key={v.id} value={v.id}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button
                    onClick={runCompare}
                    disabled={busy || !fromId || !toId}
                    className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-lg py-2.5 text-sm transition disabled:opacity-50"
                  >
                    Compare
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Comparison results */}
          {selected && comparison && (
            <div className="flex flex-col gap-6 max-w-4xl">
              <div className="flex items-start justify-between">
                <div>
                  <span className={`${mono.className} text-xs text-neutral-500`}>
                    {fromLabel} → {toLabel}
                  </span>
                  <h1 className="text-2xl font-bold text-white mt-1">API Guardian Comparison Results</h1>
                  <p className="text-sm text-neutral-500 mt-1">
                    Review the most impactful contract changes before releasing the next version.
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span
                    className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${RISK_BADGE[comparison.risk_score] ?? "bg-neutral-800 text-neutral-400 border-neutral-700"}`}
                  >
                    {comparison.risk_score} risk
                  </span>
                  <span className="text-xs text-neutral-500">
                    {criticalCount} breaking, {safeCount} safe
                  </span>
                  <button
                    onClick={handleDeleteComparison}
                    className="text-xs text-neutral-600 hover:text-red-400 transition"
                  >
                    Delete comparison
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">Change cards</h2>
                  {aiLoading && (
                    <span className={`${mono.className} text-xs text-neutral-500`}>
                      generating AI insights…
                    </span>
                  )}
                </div>

                {comparison.changes.length === 0 && (
                  <p className="text-neutral-500 text-sm">No changes detected between these versions.</p>
                )}

                {comparison.changes.map((c, i) => (
                  <div
                    key={i}
                    className={`bg-[#111214] border border-neutral-800/80 border-l-4 ${SEVERITY_BORDER[c.severity] ?? "border-l-neutral-700"} rounded-xl p-4 flex flex-col gap-2`}
                  >
                    <div className="flex items-center gap-2">
                      {c.method && (
                        <span className={`${mono.className} text-[11px] px-1.5 py-0.5 rounded bg-black/40 text-neutral-400`}>
                          {c.method}
                        </span>
                      )}
                      <span className={`${mono.className} text-sm text-neutral-200`}>{c.path}</span>
                      <span className={`ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${SEVERITY_BADGE[c.severity] ?? "bg-neutral-800 text-neutral-400"}`}>
                        {c.severity}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-neutral-200">{c.description}</p>
                    {c.ai_explanation && (
                      <p className="text-sm text-neutral-400 leading-relaxed">{c.ai_explanation}</p>
                    )}
                  </div>
                ))}
              </div>

              {aiReports.length > 0 && (
                <div className="grid grid-cols-2 gap-4">
                  {aiReports.map((r) => (
                    <div key={r.report_type} className="bg-[#111214] border border-neutral-800/80 rounded-2xl p-5 flex flex-col gap-2">
                      <h2 className="text-sm font-semibold text-white">
                        {r.report_type === "migration_guide" ? "AI Migration Guide" : "Release Notes"}
                      </h2>
                      <p className="text-xs text-neutral-500">
                        {r.report_type === "migration_guide"
                          ? "Recommended steps to safely migrate to the new version."
                          : "Concise summary of the release with emphasis on compatibility and operational impact."}
                      </p>
                      <pre className="text-sm text-neutral-300 whitespace-pre-wrap font-sans mt-1 leading-relaxed">
                        {r.content}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

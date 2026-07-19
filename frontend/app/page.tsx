// frontend/app/page.tsx
"use client";

import { useEffect, useState, useRef } from "react";
import { Space_Grotesk, JetBrains_Mono, Inter } from "next/font/google";
import { api, Project, Comparison, AIReport } from "@/lib/api";

const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "700"] });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"] });
const body = Inter({ subsets: ["latin"], weight: ["400", "500"] });

const SEVERITY_STYLES: Record<string, string> = {
  critical: "border-red-500/40 bg-red-500/10 text-red-400",
  high: "border-orange-500/40 bg-orange-500/10 text-orange-400",
  medium: "border-yellow-500/40 bg-yellow-500/10 text-yellow-400",
  safe: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
};

const RISK_STYLES: Record<string, string> = {
  critical: "text-red-400 border-red-500/50",
  high: "text-orange-400 border-orange-500/50",
  medium: "text-yellow-400 border-yellow-500/50",
  safe: "text-emerald-400 border-emerald-500/50",
};

type LocalVersion = { id: string; label: string };

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 10;

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const [versions, setVersions] = useState<LocalVersion[]>([]);
  const [label, setLabel] = useState("");
  const [rawSpec, setRawSpec] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");

  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [aiReports, setAiReports] = useState<AIReport[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    refreshProjects();
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

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
    } catch {
      setError("Couldn't create the project.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteProject(p: Project, e: React.MouseEvent) {
    e.stopPropagation(); // don't trigger selectProject when clicking delete
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

  async function uploadVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !label.trim() || !rawSpec.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const v = await api.uploadVersion(selected.id, {
        version_label: label,
        format: "json",
        raw_spec: rawSpec,
      });
      setVersions((prev) => [...prev, { id: v.id, label: v.version_label }]);
      setLabel("");
      setRawSpec("");
    } catch {
      setError("Couldn't parse that spec — check it's valid OpenAPI JSON.");
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
      // Backend returns 400 with a clear message if the version is still
      // referenced by a comparison — surface that instead of a generic error.
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

  return (
    <div className={`${body.className} min-h-screen bg-[#0B0E14] text-neutral-200`}>
      <header className="border-b border-neutral-800 px-8 py-5 flex items-center gap-3">
        <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.6)]" />
        <h1 className={`${display.className} text-lg tracking-tight text-neutral-50`}>
          API Guardian
        </h1>
        <span className={`${mono.className} text-xs text-neutral-500 ml-1`}>
          breaking-change detector
        </span>
      </header>

      {error && (
        <div className="mx-8 mt-4 px-4 py-2.5 rounded-md border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-[280px_1fr] min-h-[calc(100vh-73px)]">
        {/* Sidebar: projects */}
        <aside className="border-r border-neutral-800 p-5 flex flex-col gap-5">
          <form onSubmit={createProject} className="flex flex-col gap-2">
            <span className={`${mono.className} text-[11px] uppercase tracking-wider text-neutral-500`}>
              New project
            </span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              className="bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-sm outline-none focus:border-neutral-600"
            />
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              className="bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-sm outline-none focus:border-neutral-600"
            />
            <button
              disabled={busy}
              className="bg-neutral-100 text-neutral-900 rounded-md py-2 text-sm font-medium hover:bg-white disabled:opacity-50"
            >
              Create
            </button>
          </form>

          <div className="h-px bg-neutral-800" />

          <div className="flex flex-col gap-1">
            <span className={`${mono.className} text-[11px] uppercase tracking-wider text-neutral-500 mb-1`}>
              Projects
            </span>
            {loading && <span className="text-sm text-neutral-500">Loading…</span>}
            {!loading && projects.length === 0 && (
              <span className="text-sm text-neutral-500">No projects yet.</span>
            )}
            {projects.map((p) => (
              <div
                key={p.id}
                onClick={() => selectProject(p)}
                className={`group flex items-center justify-between px-3 py-2 rounded-md text-sm transition cursor-pointer ${
                  selected?.id === p.id
                    ? "bg-neutral-800 text-neutral-50"
                    : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
                }`}
              >
                <span>{p.name}</span>
                <button
                  onClick={(e) => handleDeleteProject(p, e)}
                  title="Delete project"
                  className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400 transition text-xs px-1.5"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* Main panel */}
        <main className="p-8">
          {!selected && (
            <div className="text-neutral-500 text-sm">
              Select or create a project to upload spec versions and compare them.
            </div>
          )}

          {selected && (
            <div className="flex flex-col gap-8 max-w-3xl">
              <div>
                <h2 className={`${display.className} text-2xl text-neutral-50`}>{selected.name}</h2>
                {selected.description && (
                  <p className="text-neutral-500 text-sm mt-1">{selected.description}</p>
                )}
              </div>

              {/* Upload version */}
              <form onSubmit={uploadVersion} className="flex flex-col gap-2">
                <span className={`${mono.className} text-[11px] uppercase tracking-wider text-neutral-500`}>
                  Upload spec version
                </span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Version label (e.g. v1, v2)"
                  className="bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-sm outline-none focus:border-neutral-600"
                />
                <textarea
                  value={rawSpec}
                  onChange={(e) => setRawSpec(e.target.value)}
                  placeholder="Paste OpenAPI spec as JSON here"
                  rows={6}
                  className={`${mono.className} bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-xs outline-none focus:border-neutral-600 resize-y`}
                />
                <button
                  disabled={busy}
                  className="self-start bg-neutral-800 rounded-md px-4 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
                >
                  Upload
                </button>
              </form>

              {/* Versions list with delete buttons */}
              {versions.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className={`${mono.className} text-[11px] uppercase tracking-wider text-neutral-500`}>
                    Uploaded versions
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {versions.map((v) => (
                      <div
                        key={v.id}
                        className="group flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2"
                      >
                        <span className={`${mono.className} text-sm text-neutral-300`}>{v.label}</span>
                        <button
                          onClick={() => handleDeleteVersion(v)}
                          title="Delete version"
                          className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400 transition text-xs px-1.5"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Uploaded versions + compare */}
              {versions.length > 0 && (
                <div className="flex flex-col gap-3">
                  <span className={`${mono.className} text-[11px] uppercase tracking-wider text-neutral-500`}>
                    Compare
                  </span>
                  <div className="flex gap-3 items-center">
                    <select
                      value={fromId}
                      onChange={(e) => setFromId(e.target.value)}
                      className="bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-sm"
                    >
                      <option value="">from…</option>
                      {versions.map((v) => (
                        <option key={v.id} value={v.id}>{v.label}</option>
                      ))}
                    </select>
                    <span className="text-neutral-600">→</span>
                    <select
                      value={toId}
                      onChange={(e) => setToId(e.target.value)}
                      className="bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-sm"
                    >
                      <option value="">to…</option>
                      {versions.map((v) => (
                        <option key={v.id} value={v.id}>{v.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={runCompare}
                      disabled={busy || !fromId || !toId}
                      className="bg-neutral-100 text-neutral-900 rounded-md px-4 py-2 text-sm font-medium hover:bg-white disabled:opacity-50"
                    >
                      Run comparison
                    </button>
                  </div>
                </div>
              )}

              {/* Results */}
              {comparison && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`inline-flex items-center gap-2 self-start border rounded-full px-4 py-1.5 ${RISK_STYLES[comparison.risk_score] ?? "border-neutral-700 text-neutral-300"}`}
                    >
                      <span className={`${mono.className} text-xs uppercase tracking-wider`}>
                        risk: {comparison.risk_score}
                      </span>
                    </div>
                    {aiLoading && (
                      <span className={`${mono.className} text-xs text-neutral-500`}>
                        generating AI insights…
                      </span>
                    )}
                    <button
                      onClick={handleDeleteComparison}
                      className="ml-auto text-xs text-neutral-500 hover:text-red-400 transition"
                    >
                      Delete comparison
                    </button>
                  </div>

                  {comparison.changes.length === 0 && (
                    <p className="text-neutral-500 text-sm">No changes detected between these versions.</p>
                  )}

                  {comparison.changes.map((c, i) => (
                    <div
                      key={i}
                      className={`border rounded-lg p-4 flex flex-col gap-1.5 ${SEVERITY_STYLES[c.severity] ?? "border-neutral-800"}`}
                    >
                      <div className="flex items-center gap-2">
                        {c.method && (
                          <span className={`${mono.className} text-[11px] px-1.5 py-0.5 rounded bg-black/30`}>
                            {c.method}
                          </span>
                        )}
                        <span className={`${mono.className} text-sm text-neutral-200`}>{c.path}</span>
                        <span className="ml-auto text-[11px] uppercase tracking-wider opacity-80">
                          {c.severity}
                        </span>
                      </div>
                      <p className="text-sm text-neutral-300">{c.description}</p>
                      {c.ai_explanation && (
                        <div className="mt-1 pt-2 border-t border-white/10">
                          <span className={`${mono.className} text-[10px] uppercase tracking-wider text-neutral-500`}>
                            AI explanation
                          </span>
                          <p className="text-sm text-neutral-300 mt-1">{c.ai_explanation}</p>
                        </div>
                      )}
                    </div>
                  ))}

                  {aiReports.map((r) => (
                    <div key={r.report_type} className="border border-neutral-800 rounded-lg p-4 flex flex-col gap-2">
                      <span className={`${mono.className} text-[11px] uppercase tracking-wider text-neutral-500`}>
                        {r.report_type === "migration_guide" ? "Migration guide" : "Release notes"}
                      </span>
                      <pre className="text-sm text-neutral-300 whitespace-pre-wrap font-sans">
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
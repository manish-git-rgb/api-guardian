"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Inter } from "next/font/google";
import { ShieldCheck } from "lucide-react";
import { api, setToken } from "@/lib/api";

const body = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "login"
          ? await api.login(email, password)
          : await api.signup(email, password);
      setToken(result.access_token);
      router.push("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      if (message.includes("401")) {
        setError("Incorrect email or password.");
      } else if (message.includes("400")) {
        setError("That email is already registered — try signing in instead.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  function handleGoogleLogin() {
    window.location.href = api.googleLoginUrl();
  }

  return (
    <div className={`${body.className} min-h-screen bg-[#0A0B0D] text-neutral-200 flex items-center justify-center px-4`}>
      <div className="w-full max-w-[420px] bg-[#111214] border border-neutral-800/80 rounded-2xl p-8 flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <ShieldCheck size={20} className="text-emerald-400" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white underline decoration-neutral-700 underline-offset-8">
            API Guardian
          </h1>
          <p className="text-sm text-neutral-500">Secure access for your API operations</p>
        </div>

        {/* Mode toggle */}
        <div className="flex bg-black/40 border border-neutral-800 rounded-lg p-1">
          <button
            onClick={() => setMode("login")}
            className={`flex-1 py-2 rounded-md text-sm font-semibold transition ${
              mode === "login"
                ? "bg-neutral-800 text-white"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Sign in
          </button>
          <button
            onClick={() => setMode("signup")}
            className={`flex-1 py-2 rounded-md text-sm font-semibold transition ${
              mode === "signup"
                ? "bg-neutral-800 text-white"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Sign up
          </button>
        </div>

        {error && (
          <div className="px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-neutral-400">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="bg-black/40 border border-neutral-800 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-emerald-600/60 transition placeholder:text-neutral-600"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-neutral-400">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="bg-black/40 border border-neutral-800 rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-emerald-600/60 transition placeholder:text-neutral-600"
            />
          </div>
          <button
            disabled={busy}
            className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-lg py-2.5 text-sm transition disabled:opacity-50 mt-1"
          >
            {mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="flex items-center gap-3 text-neutral-600 text-xs uppercase tracking-wider">
          <div className="flex-1 h-px bg-neutral-800" />
          Or
          <div className="flex-1 h-px bg-neutral-800" />
        </div>

        <button
          onClick={handleGoogleLogin}
          className="text-sm font-semibold text-neutral-200 hover:text-white border border-neutral-800 rounded-lg py-2.5 transition hover:bg-neutral-900"
        >
          Sign in with Google
        </button>

        <div className="flex items-center justify-between text-xs pt-1">
          <button className="text-neutral-500 hover:text-neutral-300 transition">
            Forgot password?
          </button>
          <span className="text-neutral-500">
            {mode === "login" ? "Don't have an account? " : "Already have an account? "}
            <button
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
              className="text-emerald-400 hover:text-emerald-300 font-medium"
            >
              {mode === "login" ? "Sign up" : "Sign in"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

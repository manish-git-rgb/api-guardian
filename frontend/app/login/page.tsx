// frontend/app/login/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Space_Grotesk, Inter } from "next/font/google";
import { api, setToken } from "@/lib/api";

const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "700"] });
const body = Inter({ subsets: ["latin"], weight: ["400", "500"] });

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
        setError("That email is already registered — try logging in instead.");
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
    <div className={`${body.className} min-h-screen bg-[#0B0E14] text-neutral-200 flex items-center justify-center`}>
      <div className="w-full max-w-sm flex flex-col gap-6 p-8">
        <div className="flex items-center gap-3 justify-center">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.6)]" />
          <h1 className={`${display.className} text-xl tracking-tight text-neutral-50`}>
            API Guardian
          </h1>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 flex flex-col gap-4">
          <div className="flex gap-2 text-sm">
            <button
              onClick={() => setMode("login")}
              className={`flex-1 py-2 rounded-md transition ${
                mode === "login" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"
              }`}
            >
              Log in
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 rounded-md transition ${
                mode === "signup" ? "bg-neutral-800 text-neutral-50" : "text-neutral-500"
              }`}
            >
              Sign up
            </button>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-md border border-red-500/30 bg-red-500/10 text-red-300 text-xs">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm outline-none focus:border-neutral-600"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm outline-none focus:border-neutral-600"
            />
            <button
              disabled={busy}
              className="bg-neutral-100 text-neutral-900 rounded-md py-2 text-sm font-medium hover:bg-white disabled:opacity-50"
            >
              {mode === "login" ? "Log in" : "Create account"}
            </button>
          </form>

          <div className="flex items-center gap-3 text-neutral-600 text-xs">
            <div className="flex-1 h-px bg-neutral-800" />
            or
            <div className="flex-1 h-px bg-neutral-800" />
          </div>

          <button
            onClick={handleGoogleLogin}
            className="bg-neutral-800 rounded-md py-2 text-sm hover:bg-neutral-700 transition"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    </div>
  );
}
// frontend/app/auth/callback/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setToken } from "@/lib/api";

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");
    if (token) {
      setToken(token);
      router.replace("/");
    } else {
      router.replace("/login");
    }
  }, [searchParams, router]);

  return (
    <div className="min-h-screen bg-[#0B0E14] text-neutral-400 flex items-center justify-center text-sm">
      Signing you in…
    </div>
  );
}
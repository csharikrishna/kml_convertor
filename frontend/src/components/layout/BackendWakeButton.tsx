"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Sparkles, Power, Server } from "lucide-react";
import { useCadastralStore } from "@/stores/useCadastralStore";
import { useConverterStore } from "@/stores/useConverterStore";

type BackendStatus = "checking" | "online" | "sleeping" | "waking" | "kaboom";

export function BackendWakeButton() {
  const [status, setStatus] = useState<BackendStatus>("checking");
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const { fetchProjectsList } = useCadastralStore();
  const { setServerCapabilities } = useConverterStore();

  const pingHealth = useCallback(async (): Promise<boolean> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const backendBase =
      process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ||
      "https://cad2kml-converter.onrender.com";
    // Test direct Render URL and relative Next.js proxy route
    const endpoints = [
      `${backendBase}/health`,
      "/health",
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.dwg_supported !== undefined) {
            setServerCapabilities(data.dwg_supported, data.limits?.max_upload_mb || 25);
          }
          return true;
        }
      } catch {
        // Try next endpoint or fail
      }
    }
    clearTimeout(timeout);
    return false;
  }, [setServerCapabilities]);

  // Initial check on mount
  useEffect(() => {
    let isMounted = true;
    pingHealth().then((isAlive) => {
      if (!isMounted) return;
      setStatus(isAlive ? "online" : "sleeping");
    });

    // Re-check when browser tab comes into focus
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        pingHealth().then((isAlive) => {
          if (!isMounted) return;
          setStatus(isAlive ? "online" : "sleeping");
        });
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pingHealth]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleWakeUp = async () => {
    if (status === "waking" || status === "kaboom") return;

    setStatus("waking");
    setSecondsElapsed(0);

    // Elapsed seconds counter
    timerRef.current = setInterval(() => {
      setSecondsElapsed((prev) => prev + 1);
    }, 1000);

    // Poll backend every 2.5 seconds
    pollRef.current = setInterval(async () => {
      const isAlive = await pingHealth();
      if (isAlive) {
        if (timerRef.current) clearInterval(timerRef.current);
        if (pollRef.current) clearInterval(pollRef.current);

        // KABOOM!
        setStatus("kaboom");

        // Refresh project list and state across the application
        fetchProjectsList();

        // After 3.5 seconds of celebratory display, smoothly hide (if alive don't show)
        setTimeout(() => {
          setStatus("online");
        }, 3500);
      }
    }, 2500);
  };

  // If backend is online, keep it completely hidden as requested ("if alive dont show")
  if (status === "online" || status === "checking") {
    return null;
  }

  // State: Sleeping (Show small red button)
  if (status === "sleeping") {
    return (
      <button
        onClick={handleWakeUp}
        type="button"
        title="Render compute backend is sleeping. Click to turn it on."
        className="h-8 px-2.5 rounded-full bg-rose-50 hover:bg-rose-100 border border-rose-200/90 hover:border-rose-300 text-rose-700 text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-all duration-200 active:scale-95 cursor-pointer shrink-0 animate-in fade-in"
      >
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600" />
        </span>
        <span className="whitespace-nowrap font-mono text-[11px]">Backend Sleeping</span>
        <span className="px-1.5 py-0.5 rounded-md bg-rose-200/70 text-rose-800 text-[10px] font-bold uppercase tracking-wider flex items-center gap-0.5">
          <Power className="w-2.5 h-2.5" /> Wake
        </span>
      </button>
    );
  }

  // State: Turning on & loading
  if (status === "waking") {
    return (
      <div
        title="Render free tier spins up in ~20-40 seconds. Polling..."
        className="h-8 px-3 rounded-full bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold flex items-center gap-2 shadow-2xs shrink-0 animate-pulse"
      >
        <Loader2 className="w-3.5 h-3.5 text-amber-600 animate-spin shrink-0" />
        <span className="whitespace-nowrap font-medium text-[11px]">
          Turning on backend... <span className="font-mono font-bold text-amber-700">({secondsElapsed}s)</span>
        </span>
      </div>
    );
  }

  // State: Kaboom! Backend loaded and live
  if (status === "kaboom") {
    return (
      <div className="h-8 px-3 rounded-full bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-bold flex items-center gap-1.5 shadow-xs shrink-0 animate-in zoom-in-95 duration-200">
        <Sparkles className="w-3.5 h-3.5 text-emerald-600 animate-bounce shrink-0" />
        <span className="whitespace-nowrap text-[11px] font-bold">
          Kaboom! Backend Live 🎉
        </span>
      </div>
    );
  }

  return null;
}

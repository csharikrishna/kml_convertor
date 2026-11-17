"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, CheckCircle2, Server, Activity, RefreshCw, Power } from "lucide-react";
import { useCadastralStore } from "@/stores/useCadastralStore";
import { useConverterStore } from "@/stores/useConverterStore";

type BackendState = "checking" | "online" | "sleeping" | "waking" | "kaboom";

export function SystemStatusDot() {
  const [backendState, setBackendState] = useState<BackendState>("checking");
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { projectData, fetchProjectsList } = useCadastralStore();
  const { setServerCapabilities } = useConverterStore();

  const pingHealth = useCallback(async (): Promise<boolean> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const backendBase =
      process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ||
      "https://cad2kml-converter.onrender.com";
    const endpoints = [`${backendBase}/health`, "/health"];

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
        // try next endpoint
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
      setBackendState(isAlive ? "online" : "sleeping");
    });

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        pingHealth().then((isAlive) => {
          if (!isMounted) return;
          setBackendState(isAlive ? "online" : "sleeping");
        });
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pingHealth]);

  // Click outside listener to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  // Action: Activate & Wake both Services
  const handleActivate = async () => {
    setIsActivating(true);
    setSecondsElapsed(0);

    // Refresh project catalog & verify topology
    fetchProjectsList();

    // Check if backend is alive
    const isAlive = await pingHealth();
    if (isAlive) {
      setBackendState("online");
      setIsActivating(false);
      return;
    }

    // Backend is sleeping: initiate polling & wake cycle
    setBackendState("waking");
    if (timerRef.current) clearInterval(timerRef.current);
    if (pollRef.current) clearInterval(pollRef.current);

    timerRef.current = setInterval(() => {
      setSecondsElapsed((prev) => prev + 1);
    }, 1000);

    let attempts = 0;
    const maxAttempts = 24; // 24 * 2.5s = 60s timeout

    pollRef.current = setInterval(async () => {
      attempts++;
      const alive = await pingHealth();
      if (alive) {
        if (timerRef.current) clearInterval(timerRef.current);
        if (pollRef.current) clearInterval(pollRef.current);
        setBackendState("kaboom");
        setIsActivating(false);
        fetchProjectsList();
        setTimeout(() => {
          setBackendState("online");
        }, 3500);
      } else if (attempts >= maxAttempts) {
        // Polling timeout: stop endless background polling and revert state
        if (timerRef.current) clearInterval(timerRef.current);
        if (pollRef.current) clearInterval(pollRef.current);
        setBackendState("sleeping");
        setIsActivating(false);
      }
    }, 2500);
  };

  const plotsCount = projectData?.survey_register?.length || 0;
  const topologySynced = plotsCount > 0;

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 300);
  };

  return (
    <div
      className="relative shrink-0"
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Small Status Dot Button */}
      <button
        type="button"
        onClick={() => {
          setIsOpen((prev) => !prev);
          if (backendState === "sleeping") {
            handleActivate();
          }
        }}
        title="System Status: Topology Synced & Compute Backend"
        className="w-8 h-8 rounded-full border border-slate-200/90 bg-white hover:bg-slate-50 flex items-center justify-center shadow-2xs transition-all active:scale-95 cursor-pointer"
      >
        {backendState === "checking" || isActivating || backendState === "waking" ? (
          <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
        ) : backendState === "online" || backendState === "kaboom" ? (
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
        ) : (
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
          </span>
        )}
      </button>

      {/* Hover & Click Popover Card */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-[350px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 z-50 text-slate-800 whitespace-normal break-words animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 font-mono">
              System & Spatial Status
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[9px] font-bold tracking-tight whitespace-nowrap ${
                backendState === "online" || backendState === "kaboom"
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                  : backendState === "waking"
                  ? "bg-amber-100 text-amber-800 border border-amber-200"
                  : "bg-rose-100 text-rose-800 border border-rose-200"
              }`}
            >
              {backendState === "online" || backendState === "kaboom"
                ? "All Systems Live"
                : backendState === "waking"
                ? `Waking (${secondsElapsed}s)`
                : "Backend Sleeping"}
            </span>
          </div>

          <div className="py-3 space-y-3">
            {/* Status Item 1: Spatial Topology */}
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                <Activity className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <span>Topology Synced</span>
                  {topologySynced && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  )}
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5 whitespace-normal break-words">
                  {topologySynced
                    ? `${plotsCount} cadastral parcels & canal alignment indexed via Shapely + R-tree.`
                    : "Spatial overlay ready; select a project to inspect topology."}
                </p>
              </div>
            </div>

            {/* Status Item 2: Backend Compute Service */}
            <div className="flex items-start gap-3">
              <div
                className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 shadow-2xs ${
                  backendState === "online" || backendState === "kaboom"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-600"
                    : backendState === "waking"
                    ? "bg-amber-50 border-amber-200 text-amber-600"
                    : "bg-rose-50 border-rose-200 text-rose-600"
                }`}
              >
                <Server className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <span>Compute Engine (Render)</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5 whitespace-normal break-words">
                  {backendState === "online" || backendState === "kaboom"
                    ? "Online • ODA DWG/DXF converter & land plan schedule ingestion active."
                    : backendState === "waking"
                    ? `Waking up compute container... (${secondsElapsed}s elapsed)`
                    : "Sleeping on free tier. Tap below to wake up container."}
                </p>
              </div>
            </div>
          </div>

          {/* Action Trigger Button */}
          <div className="pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={handleActivate}
              disabled={isActivating || backendState === "waking"}
              className={`w-full py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-xs ${
                backendState === "sleeping"
                  ? "bg-rose-600 hover:bg-rose-700 text-white"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-800"
              }`}
            >
              {isActivating || backendState === "waking" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Activating Services ({secondsElapsed}s)...</span>
                </>
              ) : backendState === "sleeping" ? (
                <>
                  <Power className="w-3.5 h-3.5" />
                  <span>Wake Compute Backend</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-slate-600" />
                  <span>Re-check & Re-sync Services</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

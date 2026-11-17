"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  Share2,
  Copy,
  Check,
  ExternalLink,
  Clock,
  Loader2,
  AlertCircle,
  Link as LinkIcon,
  Layers,
  MapPin,
  CheckCircle2,
} from "lucide-react";
import { useGisStore } from "@/stores/useGisStore";
import { useConverterStore } from "@/stores/useConverterStore";
import { useCadastralStore } from "@/stores/useCadastralStore";
import { createShareLink } from "@/lib/api/client";

export function ShareModal() {
  const { isShareModalOpen, setIsShareModalOpen, appMode } = useGisStore();
  const { result } = useConverterStore();
  const { currentProjectId, projectData, selectedPlot } = useCadastralStore();

  const [expiresInHours, setExpiresInHours] = useState(24);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [shareData, setShareData] = useState<{
    share_url: string;
    expires_at?: string;
    share_id?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const isCadastral = appMode === "survey_studio" || Boolean(projectData);

  const handleCreateShare = useCallback(
    async (hours = expiresInHours) => {
      if (isCadastral) {
        // Cadastral GIS Platform share URL with project and parcel state
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const url = `${origin}/cadastral?project=${currentProjectId}${
          selectedPlot ? `&sy=${encodeURIComponent(selectedPlot.survey_no)}` : ""
        }`;
        setShareData({
          share_url: url,
          share_id: currentProjectId,
        });
        return;
      }

      if (!result?.job_id) return;
      try {
        setIsGenerating(true);
        setErrorMsg(null);
        const res = await createShareLink(result.job_id, hours);
        const url =
          typeof window !== "undefined"
            ? `${window.location.origin}/share/${res.share_id}`
            : res.share_url;
        setShareData({
          share_url: url,
          expires_at: res.expires_at,
          share_id: res.share_id,
        });
      } catch (err: any) {
        setErrorMsg(err.message || "Failed to generate share link.");
      } finally {
        setIsGenerating(false);
      }
    },
    [isCadastral, currentProjectId, selectedPlot, result?.job_id, expiresInHours]
  );

  // Auto-generate share link as soon as modal opens
  useEffect(() => {
    if (isShareModalOpen) {
      if (isCadastral) {
        handleCreateShare();
      } else if (result?.job_id && !shareData && !isGenerating) {
        handleCreateShare(24);
      }
    }
  }, [isShareModalOpen, isCadastral, result?.job_id, shareData, isGenerating, handleCreateShare]);

  if (!isShareModalOpen) return null;

  const handleCopy = async () => {
    if (!shareData?.share_url) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareData.share_url);
      } else {
        throw new Error("Clipboard API unavailable");
      }
    } catch {
      // Fallback for non-secure contexts or older browsers
      const el = document.createElement("textarea");
      el.value = shareData.share_url;
      el.style.position = "absolute";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExpiryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = parseFloat(e.target.value);
    setExpiresInHours(val);
    if (result?.job_id) {
      handleCreateShare(val);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsShareModalOpen(false);
      }}
      className="fixed inset-0 z-[99999] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 select-none"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden relative">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center">
              <Share2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {isCadastral ? "Share Cadastral GIS Workspace" : "Share CAD Workstation"}
              </h3>
              <p className="text-[11px] text-slate-500">
                {isCadastral
                  ? "Share interactive land acquisition map with officers & engineers"
                  : "Interactive GIS project link for clients & colleagues"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsShareModalOpen(false)}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4">
          {/* Cadastral Mode View */}
          {isCadastral ? (
            <div className="space-y-4">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-slate-500">
                  <span className="font-semibold text-slate-700 flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5 text-blue-600" />
                    Active Project:
                  </span>
                  <span className="font-bold text-slate-900 font-mono">
                    {projectData?.village || currentProjectId} Canal Project
                  </span>
                </div>
                {selectedPlot && (
                  <div className="flex items-center justify-between text-slate-500 border-t border-slate-200 pt-1.5">
                    <span className="font-semibold text-slate-700 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-amber-600" />
                      Focused Survey Plot:
                    </span>
                    <span className="font-bold text-amber-800 font-mono">
                      Sy. No. {selectedPlot.survey_no} ({selectedPlot.total_acres} ac)
                    </span>
                  </div>
                )}
                <div className="text-[11px] text-slate-400">
                  Datum: EPSG:4326 (WGS84) • AP Revenue Cadastral Ground Alignment
                </div>
              </div>

              {shareData && (
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    Shareable Direct Link
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={shareData.share_url}
                      className="flex-1 font-mono text-xs rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-800 select-all focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={handleCopy}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 shadow-xs ${
                        copied
                          ? "bg-emerald-600 text-white"
                          : "bg-blue-600 text-white hover:bg-blue-700"
                      }`}
                    >
                      {copied ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <a
                  href={shareData?.share_url || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-blue-600" />
                  <span>Test Link in New Tab</span>
                </a>

                <button
                  type="button"
                  onClick={() => setIsShareModalOpen(false)}
                  className="px-4 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-xs font-semibold transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          ) : !result?.job_id ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 space-y-2 text-center">
              <AlertCircle className="w-6 h-6 text-amber-600 mx-auto" />
              <div className="text-xs font-bold text-slate-900">
                No Active Conversion Job Found
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Please convert a CAD drawing first using &quot;Convert &amp; Visualize on GIS Map&quot; to generate a shareable viewer link.
              </p>
              <button
                type="button"
                onClick={() => setIsShareModalOpen(false)}
                className="mt-2 py-1.5 px-4 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Link Expiration Duration
                </label>
                <select
                  value={expiresInHours}
                  onChange={handleExpiryChange}
                  disabled={isGenerating}
                  className="w-full text-xs font-medium rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800 focus:border-blue-500 focus:outline-hidden"
                >
                  <option value="1">1 Hour</option>
                  <option value="6">6 Hours</option>
                  <option value="12">12 Hours</option>
                  <option value="24">24 Hours (1 Day)</option>
                  <option value="72">3 Days</option>
                  <option value="168">7 Days (1 Week)</option>
                  <option value="720">30 Days (1 Month)</option>
                </select>
              </div>

              {errorMsg && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                  {errorMsg}
                </div>
              )}

              {isGenerating ? (
                <div className="py-6 flex flex-col items-center justify-center gap-2 text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  <span className="text-xs font-medium">Generating Secure Workstation Link...</span>
                </div>
              ) : shareData ? (
                <div className="space-y-3 pt-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={shareData.share_url}
                      className="flex-1 font-mono text-xs rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-800 select-all focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={handleCopy}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 shadow-xs ${
                        copied
                          ? "bg-emerald-600 text-white"
                          : "bg-blue-600 text-white hover:bg-blue-700"
                      }`}
                    >
                      {copied ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        Expires:{" "}
                        {shareData.expires_at
                          ? new Date(shareData.expires_at).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : `${expiresInHours}h`}
                      </span>
                    </div>

                    <a
                      href={shareData.share_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
                    >
                      <span>Preview View</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
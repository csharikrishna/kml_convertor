"use client";

import React, { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { useGisStore } from "@/stores/useGisStore";

export function MapSearch() {
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { flyTo } = useGisStore();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    try {
      setIsLoading(true);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          query
        )}`
      );
      const data = await res.json();
      if (data && data.length > 0) {
        const item = data[0];
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);

        flyTo([lat, lon], 14);
      } else {
        alert("Location not found. Please try another place name.");
      }
    } catch {
      alert("Error searching location. Please check your network.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSearch}
      className="absolute top-4 left-4 z-10 w-60 sm:w-72 glass-panel rounded-xl shadow-md border border-slate-200 flex items-center px-2.5 py-1"
    >
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search place, city, coordinate..."
        className="w-full text-xs bg-transparent border-none outline-hidden text-slate-800 placeholder-slate-400 py-1"
      />
      <button
        type="submit"
        disabled={isLoading}
        className="p-1 text-slate-400 hover:text-blue-600 transition-colors"
        title="Search Location"
      >
        {isLoading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Search className="w-3.5 h-3.5" />
        )}
      </button>
    </form>
  );
}

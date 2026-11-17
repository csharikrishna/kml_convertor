import type { GeoJsonFeatureCollection } from "@/types/geojson";

export interface ConversionSummaryStats {
  source_format?: string;
  total_entities?: number;
  total_vertices?: number;
  total_shapes?: number;
  total_markers?: number;
  polygons_exported?: number;
  polylines_exported?: number;
  points_exported?: number;
  labels_exported?: number;
  [key: string]: unknown;
}

export interface ConvertSuccessResponse {
  success: boolean;
  job_id: string;
  filename: string;
  download_url: string;
  stats: ConversionSummaryStats;
  warnings: string[];
  timings: Record<string, number>;
  geojson: GeoJsonFeatureCollection | null;
  preview_truncated: boolean;
}

export interface UtmZoneResponse {
  epsg: string;
  epsg_code: number;
  description: string;
}

export interface ShareResponse {
  success: boolean;
  share_id: string;
  share_url: string;
  expires_at: string;
  expires_in_hours: number;
  filename: string;
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  dwg_supported: boolean;
  temp_files_cached: number;
  conversions: {
    succeeded: number;
    failed: number;
    rejected_busy: number;
    active: number;
    failed_by_type: Record<string, number>;
  };
  limits: {
    max_upload_mb: number;
    timeout_seconds: number;
    max_concurrent: number;
  };
}

export interface ApiErrorDetail {
  status: number;
  message: string;
  details?: unknown;
}

import type {
  ConvertSuccessResponse,
  UtmZoneResponse,
  ShareResponse,
  HealthResponse,
  ApiErrorDetail,
} from "./types";
import type { ConversionParameters } from "@/types/workstation";
import type { GeoJsonFeatureCollection } from "@/types/geojson";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") || "";

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export function normalizeErrorMessage(status: number, data: any): string {
  if (data?.detail) {
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail) && data.detail[0]?.msg) {
      return data.detail.map((e: any) => e.msg).join(", ");
    }
    return JSON.stringify(data.detail);
  }
  switch (status) {
    case 400:
      return "Invalid conversion parameters or unsupported CAD file structure.";
    case 404:
      return "The requested conversion result or file was not found.";
    case 410:
      return "This shared CAD project link has expired.";
    case 413:
      return "The uploaded file exceeds the maximum allowed upload size.";
    case 422:
      return "CAD geometry validation failed during conversion.";
    case 503:
      return "The conversion server is currently busy. Please retry in a few moments.";
    case 500:
      return "Internal conversion server error. Please verify the drawing file.";
    default:
      return `Server returned an error (${status}).`;
  }
}

/**
 * Upload and convert a CAD file with genuine XMLHttpRequest upload progress reporting.
 */
export function convertCadFile(
  file: File,
  params: ConversionParameters,
  onUploadProgress?: (percent: number) => void
): Promise<ConvertSuccessResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const endpoint = `${API_BASE_URL}/api/convert`;
    xhr.open("POST", endpoint, true);

    if (onUploadProgress && xhr.upload) {
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          const percent = Math.round((evt.loaded / evt.total) * 100);
          onUploadProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      let data: any;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        data = { detail: xhr.responseText };
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as ConvertSuccessResponse);
      } else {
        const msg = normalizeErrorMessage(xhr.status, data);
        reject(new ApiError(xhr.status, msg, data));
      }
    };

    xhr.onerror = () => {
      reject(
        new ApiError(
          0,
          "Network connection interrupted. Please check your connectivity and ensure the backend is reachable."
        )
      );
    };

    xhr.ontimeout = () => {
      reject(
        new ApiError(
          408,
          "The conversion request timed out. Complex drawings may require more processing time."
        )
      );
    };

    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("input_epsg", params.input_epsg);
    formData.append("output_epsg", params.output_epsg);
    formData.append("conversion_type", params.conversion_type);
    formData.append("merge_lines", String(params.merge_lines));
    formData.append(
      "ignore_large_polygons",
      String(params.ignore_large_polygons)
    );
    formData.append("label_scale", String(params.label_scale));
    formData.append("kml_text_mode", params.kml_text_mode);
    formData.append("export_text", String(params.export_text));
    formData.append("export_points", String(params.export_points));
    formData.append("auto_scale_text", String(params.auto_scale_text));
    formData.append("fill_polygons", String(params.fill_polygons));
    formData.append("fill_color", params.fill_color);
    formData.append("fill_opacity", String(params.fill_opacity));
    formData.append("output_format", params.output_format);

    xhr.send(formData);
  });
}

export async function lookupUtmZone(
  lat: number,
  lon: number
): Promise<UtmZoneResponse> {
  const formData = new FormData();
  formData.append("lat", String(lat));
  formData.append("lon", String(lon));

  const res = await fetch(`${API_BASE_URL}/api/utm-zone`, {
    method: "POST",
    body: formData,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, normalizeErrorMessage(res.status, data), data);
  }
  return data as UtmZoneResponse;
}

export async function fetchSampleDrawingFile(): Promise<File> {
  const res = await fetch(`${API_BASE_URL}/api/sample-file`);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      "Unable to download verified sample drawing from the server."
    );
  }
  const blob = await res.blob();
  return new File([blob], "Althur_padu_bund.dwg", {
    type: "application/acad",
  });
}

export async function createShareLink(
  jobId: string,
  expiresInHours = 24
): Promise<ShareResponse> {
  const formData = new FormData();
  formData.append("job_id", jobId);
  formData.append("expires_in_hours", String(expiresInHours));

  const res = await fetch(`${API_BASE_URL}/api/share`, {
    method: "POST",
    body: formData,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, normalizeErrorMessage(res.status, data), data);
  }
  return data as ShareResponse;
}

export async function fetchSharedGeoJson(
  shareId: string
): Promise<GeoJsonFeatureCollection> {
  const res = await fetch(`${API_BASE_URL}/api/share/${encodeURIComponent(shareId)}/geojson`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, normalizeErrorMessage(res.status, data), data);
  }
  return data as GeoJsonFeatureCollection;
}

export async function checkBackendHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE_URL}/health`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, "Backend health probe failed.", data);
  }
  return data as HealthResponse;
}

export function getDownloadUrl(jobId: string, filename: string): string {
  return `${API_BASE_URL}/api/download/${jobId}/${encodeURIComponent(filename)}`;
}

export function getSharedDownloadUrl(shareId: string): string {
  return `${API_BASE_URL}/api/share/${encodeURIComponent(shareId)}/download`;
}

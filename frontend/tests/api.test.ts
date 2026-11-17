import { describe, it, expect } from "vitest";
import {
  getDownloadUrl,
  getSharedDownloadUrl,
  normalizeErrorMessage,
  ApiError,
} from "../src/lib/api/client";

describe("API Client Utilities", () => {
  it("generates correct download URLs", () => {
    const url = getDownloadUrl("abcd1234efgh5678", "drawing.kml");
    expect(url).toBe("/api/download/abcd1234efgh5678/drawing.kml");
  });

  it("encodes special characters in filenames safely", () => {
    const url = getDownloadUrl("abcd1234efgh5678", "my drawing #1 (test).kmz");
    expect(url).toContain("/api/download/abcd1234efgh5678/");
    expect(url).toContain(encodeURIComponent("my drawing #1 (test).kmz"));
  });

  it("generates correct shared download URLs", () => {
    const url = getSharedDownloadUrl("share_xyz123");
    expect(url).toBe("/api/share/share_xyz123/download");
  });

  it("normalizes standard HTTP error codes", () => {
    expect(normalizeErrorMessage(400, {})).toContain("Invalid conversion parameters");
    expect(normalizeErrorMessage(404, {})).toContain("not found");
    expect(normalizeErrorMessage(410, {})).toContain("link has expired");
    expect(normalizeErrorMessage(413, {})).toContain("maximum allowed upload size");
    expect(normalizeErrorMessage(422, {})).toContain("validation failed");
    expect(normalizeErrorMessage(500, {})).toContain("Internal conversion server error");
    expect(normalizeErrorMessage(503, {})).toContain("server is currently busy");
  });

  it("extracts custom string detail from API response", () => {
    const msg = normalizeErrorMessage(400, { detail: "Corrupted DWG header block" });
    expect(msg).toBe("Corrupted DWG header block");
  });

  it("extracts Pydantic array validation errors from detail", () => {
    const data = {
      detail: [
        { loc: ["body", "file"], msg: "Field required", type: "value_error.missing" },
        { loc: ["body", "input_epsg"], msg: "Invalid EPSG prefix", type: "value_error" },
      ],
    };
    const msg = normalizeErrorMessage(422, data);
    expect(msg).toBe("Field required, Invalid EPSG prefix");
  });

  it("constructs ApiError correctly with status and details", () => {
    const err = new ApiError(404, "Not Found", { resource: "job-123" });
    expect(err.name).toBe("ApiError");
    expect(err.status).toBe(404);
    expect(err.message).toBe("Not Found");
    expect(err.details).toEqual({ resource: "job-123" });
  });
});

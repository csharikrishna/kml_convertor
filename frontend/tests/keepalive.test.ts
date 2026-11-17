import { describe, it, expect, vi } from "vitest";
import {
  pingBackend,
  executeKeepAliveWithRetries,
} from "../../cloudflare-keepalive/src/index";

describe("Cloudflare Keep-Alive Sentinel Logic", () => {
  it("executes successful ping when backend responds with 200", async () => {
    // Mock global fetch
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        status: "healthy",
        version: "3.0.0",
        dwg_supported: true,
      }),
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await pingBackend("https://test-backend.com/health", 5000, 1);
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.backendVersion).toBe("3.0.0");
    expect(result.dwgSupported).toBe(true);
  });

  it("handles non-200 responses with descriptive error without throwing", async () => {
    const mockResponse = {
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await pingBackend("https://test-backend.com/health", 5000, 1);
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(503);
    expect(result.error).toContain("HTTP 503");
  });

  it("handles timeouts gracefully with AbortError simulation", async () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    global.fetch = vi.fn().mockRejectedValue(abortErr);

    const result = await pingBackend("https://test-backend.com/health", 100, 1);
    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("retries up to maxRetries on failure", async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 2) {
        return { ok: false, status: 500, statusText: "Internal Error" };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "healthy" }),
      };
    });

    const result = await executeKeepAliveWithRetries("https://test-backend.com/health", 2000, 3);
    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
    expect(result.attempt).toBe(2);
  });
});

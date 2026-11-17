/**
 * Cloudflare Worker: CAD2KML Backend Keep-Alive & Health Sentinel
 *
 * Runs on a 10-minute cron cadence to prevent Render backend container sleep,
 * detect cold starts, record health status, and handle network transient failures
 * with bounded exponential backoff retries and timeout boundaries.
 */

export interface Env {
  BACKEND_HEALTH_URL?: string;
  TIMEOUT_MS?: string;
  MAX_RETRIES?: string;
}

export interface PingResult {
  url: string;
  success: boolean;
  statusCode?: number;
  durationMs: number;
  attempt: number;
  error?: string;
  timestamp: string;
  backendVersion?: string;
  dwgSupported?: boolean;
}

/**
 * Pings backend health endpoint with timeout and error protection
 */
export async function pingBackend(
  url: string,
  timeoutMs: number,
  attempt: number
): Promise<PingResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Cloudflare-Worker-KeepAlive/2.0 (CAD2KML-Sentinel)",
        "Accept": "application/json",
      },
    });

    clearTimeout(timer);
    const durationMs = Date.now() - started;

    if (res.ok) {
      const data: any = await res.json().catch(() => ({}));
      return {
        url,
        success: true,
        statusCode: res.status,
        durationMs,
        attempt,
        timestamp: new Date().toISOString(),
        backendVersion: data.version,
        dwgSupported: data.dwg_supported,
      };
    } else {
      return {
        url,
        success: false,
        statusCode: res.status,
        durationMs,
        attempt,
        error: `HTTP ${res.status} ${res.statusText}`,
        timestamp: new Date().toISOString(),
      };
    }
  } catch (err: any) {
    clearTimeout(timer);
    const durationMs = Date.now() - started;
    const isTimeout = err?.name === "AbortError";
    return {
      url,
      success: false,
      durationMs,
      attempt,
      error: isTimeout ? `Request timed out after ${timeoutMs}ms` : err?.message || "Network error",
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Executes keepalive with bounded exponential backoff retries
 */
export async function executeKeepAliveWithRetries(
  url: string,
  timeoutMs: number,
  maxRetries: number
): Promise<PingResult> {
  let lastResult: PingResult | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    lastResult = await pingBackend(url, timeoutMs, attempt);
    if (lastResult.success) {
      return lastResult;
    }

    if (attempt < maxRetries) {
      // Exponential backoff: 1s, 2s, 4s...
      const backoffMs = Math.min(5000, 1000 * Math.pow(2, attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  return (
    lastResult || {
      url,
      success: false,
      durationMs: 0,
      attempt: maxRetries,
      error: "No attempts executed",
      timestamp: new Date().toISOString(),
    }
  );
}

export default {
  /**
   * Cloudflare Scheduled Cron Handler
   */
  async scheduled(
    event: { scheduledTime: number; cron: string },
    env: Env,
    ctx: { waitUntil: (p: Promise<any>) => void }
  ): Promise<void> {
    const url = env.BACKEND_HEALTH_URL || "https://cad2kml-converter.onrender.com/health";
    const timeoutMs = parseInt(env.TIMEOUT_MS || "15000", 10);
    const maxRetries = parseInt(env.MAX_RETRIES || "3", 10);

    const task = executeKeepAliveWithRetries(url, timeoutMs, maxRetries).then((result) => {
      if (result.success) {
        console.log(
          `[KeepAlive Sentinel] SUCCESS: Pinged ${result.url} in ${result.durationMs}ms (Attempt ${result.attempt}/${maxRetries})`
        );
      } else {
        console.error(
          `[KeepAlive Sentinel] FAILURE: Failed to ping ${result.url} after ${result.attempt} attempts. Error: ${result.error}`
        );
      }
    });

    ctx.waitUntil(task);
  },

  /**
   * HTTP Handler for manual trigger & status check
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = env.BACKEND_HEALTH_URL || "https://cad2kml-converter.onrender.com/health";
    const timeoutMs = parseInt(env.TIMEOUT_MS || "15000", 10);
    const maxRetries = parseInt(env.MAX_RETRIES || "2", 10);

    const result = await executeKeepAliveWithRetries(url, timeoutMs, maxRetries);

    return new Response(JSON.stringify(result, null, 2), {
      status: result.success ? 200 : 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  },
};

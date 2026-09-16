/**
 * Performance metrics capture through the stable T19 observability contract (T21,
 * REQ-PERF-001..003, REQ-VERIFY-003).
 *
 * Captures the frame-time distribution (p50/p95/p99 — never average-only), FPS, draw
 * calls, triangles, texture/resource counts, readiness/load time, and console-error
 * counts EXCLUSIVELY through the stable `renderer.stats()` / `renderer.probe()` seams
 * of the mounted `__GAUNTLET_STUDIO_OBS__` v1 surface — never DOM or provider-internal
 * names (REQ-OBS-004). Capture is OBSERVATION ONLY: no budget is evaluated here and no
 * profile rule is applied; that is studio-owned settlement interpretation.
 *
 * The software-rendering guard input (REQ-PERF-003) is classified here from the
 * renderer identity probe: SwiftShader/llvmpipe-class identities mark the evidence
 * non-target so a software-rendered run can never masquerade as target-hardware
 * evidence downstream.
 */

import type {
  FrameTimeDistribution,
  JsHeapMemoryBytes,
  PerformanceChannelEvidence,
  RendererEvidenceClass,
} from "./types";

/** Nearest-rank percentile over a pre-sorted array (deterministic). */
export function percentileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new RangeError("percentileSorted requires a non-empty array");
  const idx = Math.min(Math.max(Math.ceil(q * sorted.length) - 1, 0), sorted.length - 1);
  return sorted[idx];
}

/** Deterministic nearest-rank frame-time distribution (p50/p95/p99). */
export function computeFrameTimeDistribution(samples: readonly unknown[]): FrameTimeDistribution | null {
  const clean = samples.filter(
    (s): s is number => typeof s === "number" && Number.isFinite(s) && s >= 0
  );
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const avg = clean.reduce((sum, v) => sum + v, 0) / clean.length;
  return {
    avg,
    p50: percentileSorted(sorted, 0.5),
    p95: percentileSorted(sorted, 0.95),
    p99: percentileSorted(sorted, 0.99),
    samples: clean.length,
  };
}

/**
 * Software-renderer identity markers (REQ-PERF-003): SwiftShader, llvmpipe, softpipe,
 * and explicit software rasterizer/renderer strings. Matched case-insensitively
 * against any string value of the probe identity record.
 */
export const SOFTWARE_RENDERER_PATTERN = /swiftshader|llvmpipe|softpipe|software\s*(rasterizer|renderer|webgl)/i;

/**
 * Classifies a renderer identity (read via the stable renderer probe) into
 * hardware/software/unknown. `unknown` can never satisfy a hardware-target binding.
 */
export function classifyRendererIdentity(identity: Record<string, unknown> | undefined): RendererEvidenceClass {
  if (!identity || typeof identity !== "object") return "unknown";
  let sawRendererString = false;
  for (const value of Object.values(identity)) {
    if (typeof value === "string" && value.trim().length > 0) {
      sawRendererString = true;
      if (SOFTWARE_RENDERER_PATTERN.test(value)) return "software";
    }
  }
  return sawRendererString ? "hardware" : "unknown";
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const MB = 1024 * 1024;

/**
 * Normalizes a raw Chrome `performance.memory` read (bytes) into MB. Pure and
 * deterministic; returns null when the browser exposes no usable JS-heap reading
 * (non-Chromium engines, permission-restricted contexts) so the absence can be
 * recorded honestly in `unreported` instead of fabricated.
 */
export function normalizeJsHeapMemory(raw: JsHeapMemoryBytes | null | undefined): {
  used_mb?: number;
  limit_mb?: number;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const usedBytes = num(raw.usedJSHeapSize);
  if (usedBytes === undefined || usedBytes < 0) return null;
  const limitBytes = num(raw.jsHeapSizeLimit);
  return {
    used_mb: usedBytes / MB,
    ...(limitBytes !== undefined && limitBytes > 0 ? { limit_mb: limitBytes / MB } : {}),
  };
}

export interface CapturePerformanceInput {
  /** Named quality profile the capture is taken under (declared by the game project). */
  quality_profile: string;
  /** Raw `renderer.stats()` read; `present:false` responses pass null here. */
  rendererStats: Record<string, unknown> | null;
  rendererStatsReason?: string;
  /** Raw `renderer.probe()` identity record (undefined when absent). */
  rendererIdentity?: Record<string, unknown>;
  /** Console error/warning count observed during the run (telemetry channel collector). */
  console_errors: number;
  /**
   * Raw Chrome `performance.memory` read from the harness page-evaluation seam
   * (T21 hardening). Used as the JS-heap memory source when the stable renderer
   * stats do not declare `memory_used_mb` themselves; a browser that exposes no
   * reading records the metric in `unreported` (a declared `max_memory_mb` budget
   * then fails evaluation as unreported — never silently passes).
   */
  memory?: JsHeapMemoryBytes | null;
}

/**
 * Captures one performance evidence record from stable-surface reads.
 * When the surface cannot produce renderer stats, `present:false` is recorded —
 * the missing measurement is preserved honestly and can never evaluate as a pass.
 */
export function capturePerformanceEvidence(input: CapturePerformanceInput): PerformanceChannelEvidence {
  const readVia = ["renderer.stats()", "renderer.probe()"];
  if (!input.rendererStats) {
    return {
      channel: "performance",
      quality_profile: input.quality_profile,
      present: false,
      reason: input.rendererStatsReason ?? "renderer stats not available on the stable surface",
      metrics: { console_errors: input.console_errors },
      unreported: [
        "fps_avg",
        "frame_time_ms.p50",
        "frame_time_ms.p95",
        "frame_time_ms.p99",
        "draw_calls",
        "triangles",
        "textures",
        "resources",
        "readiness_ms",
        "memory_used_mb",
      ],
      renderer_class: classifyRendererIdentity(input.rendererIdentity),
      read_via: readVia,
    };
  }

  const stats = input.rendererStats;
  const unreported: string[] = [];
  const fpsAvg = num(stats.fps_avg);
  if (fpsAvg === undefined) unreported.push("fps_avg");
  const drawCalls = num(stats.draw_calls);
  if (drawCalls === undefined) unreported.push("draw_calls");
  const triangles = num(stats.triangles);
  if (triangles === undefined) unreported.push("triangles");
  const textures = num(stats.textures);
  if (textures === undefined) unreported.push("textures");
  const resources = num(stats.resources);
  if (resources === undefined) unreported.push("resources");
  const readinessMs = num(stats.readiness_ms);
  if (readinessMs === undefined) unreported.push("readiness_ms");

  // Frame-time distribution: raw samples preferred; explicit declared percentiles
  // accepted; NEITHER means the percentiles are unreported (average-only reporters
  // are rejected downstream per declared profile metric rules).
  const rawSamples = Array.isArray(stats.frame_time_samples_ms) ? stats.frame_time_samples_ms : null;
  const dist =
    (rawSamples && computeFrameTimeDistribution(rawSamples)) ??
    (num(stats.frame_time_p50_ms) !== undefined &&
    num(stats.frame_time_p95_ms) !== undefined &&
    num(stats.frame_time_p99_ms) !== undefined
      ? {
          avg: num(stats.frame_time_avg_ms) ?? num(stats.frame_time_p50_ms)!,
          p50: num(stats.frame_time_p50_ms)!,
          p95: num(stats.frame_time_p95_ms)!,
          p99: num(stats.frame_time_p99_ms)!,
          samples: num(stats.frame_time_sample_count) ?? 0,
        }
      : null);
  if (!dist) {
    unreported.push("frame_time_ms.p50", "frame_time_ms.p95", "frame_time_ms.p99");
  }

  // JS-heap memory (T21 hardening): the stable renderer stats seam takes precedence
  // (a title/fixture that measures its own heap reports `memory_used_mb` in MB);
  // otherwise the harness-provided Chrome `performance.memory` page read is used.
  // Neither source reporting the heap records `memory_used_mb` in `unreported`.
  const statsMemoryUsed = num(stats.memory_used_mb);
  const statsMemoryLimit = num(stats.memory_heap_limit_mb);
  let memoryUsedMb = statsMemoryUsed;
  let memoryLimitMb = statsMemoryLimit;
  if (memoryUsedMb === undefined) {
    const heap = normalizeJsHeapMemory(input.memory);
    if (heap) {
      memoryUsedMb = heap.used_mb;
      memoryLimitMb = heap.limit_mb;
    }
  }
  if (memoryUsedMb === undefined) unreported.push("memory_used_mb");

  return {
    channel: "performance",
    quality_profile: input.quality_profile,
    present: true,
    metrics: {
      ...(fpsAvg !== undefined ? { fps_avg: fpsAvg } : {}),
      ...(dist ? { frame_time_ms: dist } : {}),
      ...(drawCalls !== undefined ? { draw_calls: drawCalls } : {}),
      ...(triangles !== undefined ? { triangles } : {}),
      ...(textures !== undefined ? { textures } : {}),
      ...(resources !== undefined ? { resources } : {}),
      ...(readinessMs !== undefined ? { readiness_ms: readinessMs } : {}),
      ...(memoryUsedMb !== undefined ? { memory_used_mb: memoryUsedMb } : {}),
      ...(memoryLimitMb !== undefined ? { memory_heap_limit_mb: memoryLimitMb } : {}),
      console_errors: input.console_errors,
    },
    unreported,
    renderer_class: classifyRendererIdentity(input.rendererIdentity),
    read_via: readVia,
  };
}

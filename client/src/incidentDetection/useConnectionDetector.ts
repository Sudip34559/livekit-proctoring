import { useEffect, useRef } from "react";
import type { DetectionConfig, IncidentType } from "./types";
import { getCooldownMs } from "./config";
import type { CooldownManager } from "./CooldownManager";

interface Options {
  enabled: boolean;
  examId: string;
  config: DetectionConfig;
  getCooldowns: () => CooldownManager;
  fire: (
    type: IncidentType,
    message: string,
    meta?: Record<string, unknown>,
  ) => void;
  /** Optional API base URL for heartbeat pings */
  heartbeatUrl?: string;
  heartbeatIntervalMs?: number;
  timeoutThresholdMs?: number;
}

/**
 * Detects:
 *  - connection_lost  (heartbeat failure, navigator.offline, poor network quality)
 *
 * Strategy:
 *  1. navigator online/offline events  (instant)
 *  2. navigator.connection quality API (30 s check)
 *  3. Periodic fetch heartbeat         (60 s, optional)
 *  4. Timeout guard                    (if last heartbeat > threshold)
 */
export function useConnectionDetector({
  enabled,
  examId,
  config,
  getCooldowns,
  fire,
  heartbeatUrl,
  heartbeatIntervalMs = 60_000,
  timeoutThresholdMs = 180_000,
}: Options) {
  const { incidentSettings, incidentCooldowns, cooldownMs } = config;
  const lastHeartbeatRef = useRef<number>(0);
  const qualityRef = useRef<"good" | "poor" | "disconnected">("good");
  const failuresRef = useRef(0);
  const cooldowns = getCooldowns();
  useEffect(() => {
    if (!enabled || !incidentSettings.connectionLost.enabled) return;

    lastHeartbeatRef.current = Date.now();

    const connCd = getCooldownMs(
      "connection_lost",
      incidentCooldowns,
      cooldownMs,
    );

    const tryFire = (msg: string, meta?: Record<string, unknown>) => {
      if (cooldowns.tryFire("connection_lost", connCd)) {
        fire("connection_lost", msg, meta);
      }
    };

    // ── navigator.online/offline ──────────────────────────────────────────────
    const onOnline = () => {
      qualityRef.current = "good";
      failuresRef.current = 0;
    };
    const onOffline = () => {
      qualityRef.current = "disconnected";
      tryFire("Internet connection lost");
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // ── Network quality (navigator.connection) ────────────────────────────────
    const qualityCheckId = setInterval(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conn = (navigator as any).connection;
      if (!conn) return;
      const { effectiveType, downlink } = conn;
      if (
        effectiveType === "slow-2g" ||
        effectiveType === "2g" ||
        downlink < 1
      ) {
        if (qualityRef.current !== "poor") {
          qualityRef.current = "poor";
          tryFire("Poor network connection detected", {
            effectiveType,
            downlink,
          });
        }
      } else {
        qualityRef.current = "good";
      }
    }, 30_000);

    // ── Heartbeat (optional) ──────────────────────────────────────────────────
    const FAILURE_THRESHOLD = 5;
    let heartbeatId: ReturnType<typeof setInterval> | null = null;

    if (heartbeatUrl) {
      heartbeatId = setInterval(async () => {
        try {
          const res = await fetch(
            `${heartbeatUrl}/api/exams/${examId}/heartbeat`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (res.ok) {
            lastHeartbeatRef.current = Date.now();
            failuresRef.current = 0;
            qualityRef.current = "good";
          } else {
            throw new Error(`HTTP ${res.status}`);
          }
        } catch {
          failuresRef.current++;
          if (failuresRef.current >= FAILURE_THRESHOLD) {
            qualityRef.current = "disconnected";
            tryFire("Heartbeat failure – server unreachable", {
              failures: failuresRef.current,
            });
          }
        }
      }, heartbeatIntervalMs);
    }

    // ── Timeout guard ─────────────────────────────────────────────────────────
    const timeoutId = setInterval(() => {
      const elapsed = Date.now() - lastHeartbeatRef.current;
      if (
        elapsed > timeoutThresholdMs &&
        qualityRef.current !== "disconnected"
      ) {
        qualityRef.current = "disconnected";
        tryFire("Connection timeout – no response for >3 minutes", {
          elapsedMs: elapsed,
        });
      }
    }, 15_000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(qualityCheckId);
      clearInterval(timeoutId);
      if (heartbeatId) clearInterval(heartbeatId);
    };
  }, [
    enabled,
    incidentSettings.connectionLost.enabled,
    examId,
    incidentCooldowns,
    cooldownMs,
    heartbeatUrl,
    cooldowns,
    fire,
    heartbeatIntervalMs,
    timeoutThresholdMs,
  ]);
}

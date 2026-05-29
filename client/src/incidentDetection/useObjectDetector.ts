import { useEffect } from "react";
import type { DetectionConfig, IncidentType } from "./types";
import { getCooldownMs } from "./config";
import { CooldownManager } from "./CooldownManager";

interface Options {
  enabled: boolean;
  mediaStream: MediaStream | null;
  config: DetectionConfig;
  getCooldowns: () => CooldownManager;

  fire: (
    type: IncidentType,
    message: string,
    meta?: Record<string, unknown>,
  ) => void;
}

const VIOLATION_CLASSES = new Set([
  "cell phone",
  "phone",
  "mobile",
  "laptop",
  "tablet",
  "book",
  "paper",
]);

/**
 * Detects:
 *  - unauthorized_object_detected  (COCO-SSD model, lazy-loaded)
 *
 * Gracefully degrades to a no-op when @tensorflow-models/coco-ssd is absent.
 */
export function useObjectDetector({
  enabled,
  mediaStream,
  config,
  getCooldowns,
  fire,
}: Options) {
  const { incidentSettings, incidentCooldowns, cooldownMs } = config;
  const cooldowns = getCooldowns();
  useEffect(() => {
    if (!enabled || !incidentSettings.unauthorizedObjectDetected.enabled)
      return;
    if (!mediaStream) return;

    let isMounted = true;
    let animId: number;
    let videoEl: HTMLVideoElement | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let model: any = null;

    const objCd = getCooldownMs(
      "unauthorized_object_detected",
      incidentCooldowns,
      cooldownMs,
    );
    let skipCount = 0;
    const SKIP_FRAMES = 3; // only detect every 4th rAF

    const run = async () => {
      try {
        // Lazy-load tensorflow + coco-ssd at runtime
        await import("@tensorflow/tfjs");
        const cocoSsd = await import("@tensorflow-models/coco-ssd");
        model = await cocoSsd.load();
      } catch {
        console.warn(
          "[ObjectDetector] @tensorflow-models/coco-ssd not available – skipping object detection",
        );
        return;
      }

      videoEl = document.createElement("video");
      videoEl.style.cssText = "display:none;position:absolute;left:-9999px";
      videoEl.autoplay = true;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.srcObject = mediaStream;
      document.body.appendChild(videoEl);

      videoEl.play().catch(() => {});

      const detect = async () => {
        if (!isMounted) return;

        if (++skipCount < SKIP_FRAMES) {
          animId = requestAnimationFrame(detect);
          return;
        }
        skipCount = 0;

        if (videoEl && videoEl.readyState >= 2 && model) {
          try {
            const predictions: Array<{ class: string; score: number }> =
              await model.detect(videoEl);
            for (const p of predictions) {
              if (VIOLATION_CLASSES.has(p.class.toLowerCase())) {
                if (cooldowns.tryFire("unauthorized_object_detected", objCd))
                  fire(
                    "unauthorized_object_detected",
                    `Unauthorized object detected: ${p.class}`,
                    { object: p.class, confidence: p.score },
                  );
                break; // one incident per sweep
              }
            }
          } catch (err) {
            console.warn("[ObjectDetector] detect error:", err);
          }
        }

        animId = requestAnimationFrame(detect);
      };

      detect();
    };

    run();

    return () => {
      isMounted = false;
      cancelAnimationFrame(animId);
      videoEl?.remove();
    };
  }, [
    enabled,
    mediaStream,
    incidentSettings.unauthorizedObjectDetected.enabled,
    incidentCooldowns,
    cooldownMs,
    cooldowns,
    fire,
  ]);
}

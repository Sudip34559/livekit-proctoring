import { useEffect, useRef, useCallback } from "react";
import { api } from "./Api";
import type { Incident } from "./types";

interface UseAntiCheatOptions {
  examId: string;
  participantIdentity: string;
  enabled: boolean;
}

export function useAntiCheat({
  examId,
  participantIdentity,
  enabled,
}: UseAntiCheatOptions) {
  const reportedTabSwitch = useRef(false);
  const faceCheckInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const reportIncident = useCallback(
    async (
      type: Incident["type"],
      severity: Incident["severity"],
      note?: string,
    ) => {
      try {
        await api.reportIncident(examId, {
          examId,
          participantIdentity,
          type,
          severity,
          note,
        });
      } catch (err) {
        console.error("Failed to report incident:", err);
      }
    },
    [examId, participantIdentity],
  );

  // Tab / window visibility detection
  useEffect(() => {
    if (!enabled) return;

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        reportedTabSwitch.current = true;
        reportIncident(
          "tab_switch",
          "high",
          "Participant switched tab or minimized window",
        );
      }
    };

    const handleBlur = () => {
      reportIncident("tab_switch", "medium", "Window lost focus");
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("blur", handleBlur);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("blur", handleBlur);
    };
  }, [enabled, reportIncident]);

  // Right-click / devtools prevention (best-effort)
  useEffect(() => {
    if (!enabled) return;

    const prevent = (e: MouseEvent) => e.preventDefault();
    const preventKeys = (e: KeyboardEvent) => {
      // Prevent F12, Ctrl+Shift+I, Ctrl+U, Ctrl+S
      if (
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && e.key === "I") ||
        (e.ctrlKey && e.key === "u") ||
        (e.ctrlKey && e.key === "s")
      ) {
        e.preventDefault();
        reportIncident("tab_switch", "medium", `Attempted key: ${e.key}`);
      }
    };

    document.addEventListener("contextmenu", prevent);
    document.addEventListener("keydown", preventKeys);

    return () => {
      document.removeEventListener("contextmenu", prevent);
      document.removeEventListener("keydown", preventKeys);
    };
  }, [enabled, reportIncident]);

  // Attach a hidden video + canvas for basic face-count heuristic
  const attachVideoStream = useCallback(
    (stream: MediaStream) => {
      if (!enabled) return;

      // Create hidden elements
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.style.display = "none";
      document.body.appendChild(video);
      video.play();
      videoRef.current = video;

      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 120;
      canvas.style.display = "none";
      document.body.appendChild(canvas);
      canvasRef.current = canvas;

      // Periodic brightness check — a very simple proxy for "is there a face"
      // (full ML face detection would require a model like face-api.js)
      let noFaceCount = 0;

      faceCheckInterval.current = setInterval(() => {
        const ctx = canvas.getContext("2d");
        if (!ctx || video.readyState < 2) return;

        ctx.drawImage(video, 0, 0, 160, 120);
        const data = ctx.getImageData(0, 0, 160, 120).data;

        // Compute average luminance
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
          total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
        const avg = total / (data.length / 4);

        if (avg < 10) {
          // Very dark — camera covered or off
          noFaceCount++;
          if (noFaceCount === 3) {
            reportIncident(
              "no_face",
              "high",
              "Camera appears covered or turned off",
            );
            noFaceCount = 0;
          }
        } else {
          noFaceCount = 0;
        }
      }, 8000);
    },
    [enabled, reportIncident],
  );

  const cleanup = useCallback(() => {
    if (faceCheckInterval.current) clearInterval(faceCheckInterval.current);
    videoRef.current?.remove();
    canvasRef.current?.remove();
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  return { reportIncident, attachVideoStream, cleanup };
}

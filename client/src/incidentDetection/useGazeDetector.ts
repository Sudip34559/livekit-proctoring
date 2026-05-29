import { useEffect, useRef } from "react";
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

type FaceMeshInstance = {
  setOptions: (o: {
    maxNumFaces: number;
    refineLandmarks: boolean;
    minDetectionConfidence: number;
    minTrackingConfidence: number;
  }) => Promise<void>;
  onResults: (
    cb: (r: { multiFaceLandmarks?: { x: number; y: number }[][] }) => void,
  ) => void;
  send: (o: { image: HTMLVideoElement }) => Promise<void>;
  close: () => void;
};

type FaceMeshConstructor = new (opts: {
  locateFile: (f: string) => string;
}) => FaceMeshInstance;

export function useGazeDetector({
  enabled,
  mediaStream,
  config,
  getCooldowns,
  fire,
}: Options) {
  const { incidentSettings, incidentCooldowns, cooldownMs } = config;
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const gazeEnabled =
    incidentSettings.lookingAwayFromScreen.enabled ||
    incidentSettings.multipleFacesInFrontOfCamera.enabled ||
    incidentSettings.noFaceFound.enabled;

  useEffect(() => {
    if (!enabled || !gazeEnabled || !mediaStream) return;

    const cooldowns = getCooldowns();
    let isMounted = true;
    let videoEl: HTMLVideoElement | null = null;
    let animId: number;
    let fallbackCleanup: (() => void) | null = null;

    let missingFaceFrames = 0;
    let gazeAwayFrames = 0;
    let multiFaceFrames = 0;

    const FRAME_INTERVAL = 500;
    const MAX_MISSING = 10;
    const MAX_GAZE_AWAY = 3;
    const MAX_MULTI_FACES = 8;

    const noFaceCd = getCooldownMs(
      "no_face_found",
      incidentCooldowns,
      cooldownMs,
    );
    const gazeAwayCd = getCooldownMs(
      "looking_away_from_screen",
      incidentCooldowns,
      cooldownMs,
    );
    const multiFaceCd = getCooldownMs(
      "multiple_faces_in_front_of_camera",
      incidentCooldowns,
      cooldownMs,
    );

    // ── Helpers ──────────────────────────────────────────────────────────────
    const analyzeGaze = (
      landmarks: { x: number; y: number }[],
    ): { away: boolean; reason: string } => {
      try {
        const lEye = landmarks[159],
          rEye = landmarks[386];
        const lIris = landmarks[468],
          rIris = landmarks[473];
        const nose = landmarks[1];
        const lMouth = landmarks[61],
          rMouth = landmarks[291];

        const headTilt = Math.abs(lEye.y - rEye.y);
        const headYaw = Math.abs(nose.x - 0.5);
        const headRoll = Math.abs(lMouth.y - rMouth.y);

        const lEyeCx = (landmarks[33].x + landmarks[133].x) / 2;
        const rEyeCx = (landmarks[362].x + landmarks[263].x) / 2;
        const lDev = Math.abs(lIris.x - lEyeCx);
        const rDev = Math.abs(rIris.x - rEyeCx);

        const reasons: string[] = [];
        if (headTilt > 0.025) reasons.push("Head tilted");
        if (headYaw > 0.02) reasons.push("Head turned away");
        if (headRoll > 0.035) reasons.push("Head rolled");
        if (lDev > 0.05 || rDev > 0.05) reasons.push("Eyes not on screen");
        if (headYaw > 0.4) reasons.push("Head significantly turned");

        return { away: reasons.length > 0, reason: reasons.join(", ") };
      } catch {
        return { away: false, reason: "" };
      }
    };

    const isValidFace = (landmarks: { x: number; y: number }[]): boolean => {
      if (!landmarks || landmarks.length < 468) return false;
      const xs = landmarks.map((l) => l.x);
      const ys = landmarks.map((l) => l.y);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      if (w * h < 0.02) return false;
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      if (cx < 0.05 || cx > 0.95 || cy < 0.05 || cy > 0.95) return false;
      return true;
    };

    const makeVideo = (): HTMLVideoElement => {
      const v = document.createElement("video");
      v.style.cssText = "display:none;position:absolute;left:-9999px";
      v.autoplay = true;
      v.muted = true;
      v.playsInline = true;
      v.width = 640;
      v.height = 480;
      v.srcObject = mediaStream;
      document.body.appendChild(v);
      return v;
    };

    // ── Brightness fallback ───────────────────────────────────────────────────
    const startBrightnessFallback = () => {
      videoEl = makeVideo();
      videoEl.play().catch(() => {});

      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 120;
      // Fix: willReadFrequently avoids repeated-readback perf warning
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let darkCount = 0;

      const id = setInterval(() => {
        if (!isMounted || !ctx || !videoEl || videoEl.readyState < 2) return;
        ctx.drawImage(videoEl, 0, 0, 160, 120);
        const data = ctx.getImageData(0, 0, 160, 120).data;
        let total = 0;
        for (let i = 0; i < data.length; i += 4)
          total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const avg = total / (data.length / 4);

        if (avg < 10) {
          if (++darkCount >= 3) {
            if (cooldowns.tryFire("no_face_found", noFaceCd))
              fire("no_face_found", "Camera appears covered or very dark");
            darkCount = 0;
          }
        } else {
          darkCount = 0;
        }
      }, FRAME_INTERVAL);

      fallbackCleanup = () => {
        clearInterval(id);
        videoEl?.remove();
        canvas.remove();
      };
    };

    const resolveFaceMeshCtor = async (): Promise<FaceMeshConstructor> => {
      const mod = (await import("@mediapipe/face_mesh")) as Record<
        string,
        unknown
      >;

      const fromDefault =
        mod.default != null &&
        typeof (mod.default as Record<string, unknown>).FaceMesh === "function"
          ? (mod.default as Record<string, unknown>).FaceMesh
          : undefined;

      const fromNamed =
        typeof mod.FaceMesh === "function" ? mod.FaceMesh : undefined;

      const fromGlobal =
        typeof (window as Record<string, unknown>).FaceMesh === "function"
          ? (window as Record<string, unknown>).FaceMesh
          : undefined;

      const Ctor = fromDefault ?? fromNamed ?? fromGlobal;

      if (typeof Ctor !== "function") {
        throw new Error(
          `FaceMesh constructor not found. ` +
            `mod keys: [${Object.keys(mod).join(", ")}], ` +
            `default type: ${typeof mod.default}`,
        );
      }

      return Ctor as unknown as FaceMeshConstructor;
    };

    // ── MediaPipe loader ──────────────────────────────────────────────────────
    const startWithMediaPipe = async () => {
      // const FaceMeshCtor = await resolveFaceMeshCtor();
      const Ctor = await resolveFaceMeshCtor();
      try {
        const faceMesh = new Ctor({
          locateFile: (f: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${f}`,
        });

        console.log(faceMesh);

        await faceMesh.setOptions({
          maxNumFaces: 3,
          refineLandmarks: true,
          minDetectionConfidence: 0.75,
          minTrackingConfidence: 0.75,
        });

        videoEl = makeVideo();

        await new Promise<void>((res, rej) => {
          videoEl!.onloadedmetadata = () => res();
          videoEl!.onerror = () => rej(new Error("video load failed"));
          setTimeout(() => rej(new Error("video metadata timeout")), 5_000);
        });
        await videoEl.play();

        faceMesh.onResults((results) => {
          if (!isMounted) return;
          const cfg = configRef.current;
          const faces = results.multiFaceLandmarks ?? [];

          // No face
          if (cfg.incidentSettings.noFaceFound.enabled) {
            if (faces.length === 0) {
              gazeAwayFrames = 0;
              if (++missingFaceFrames >= MAX_MISSING) {
                if (cooldowns.tryFire("no_face_found", noFaceCd))
                  fire("no_face_found", "No face visible in camera");
              }
              return;
            }
            missingFaceFrames = 0;
          }

          // Multiple faces
          if (cfg.incidentSettings.multipleFacesInFrontOfCamera.enabled) {
            const valid = faces.filter(isValidFace);
            if (valid.length > 1) {
              if (++multiFaceFrames >= MAX_MULTI_FACES) {
                if (
                  cooldowns.tryFire(
                    "multiple_faces_in_front_of_camera",
                    multiFaceCd,
                  )
                )
                  fire(
                    "multiple_faces_in_front_of_camera",
                    `${valid.length} faces detected in camera`,
                    { count: valid.length },
                  );
                multiFaceFrames = 0;
              }
              return;
            }
            multiFaceFrames = 0;
          }

          // Gaze
          if (
            cfg.incidentSettings.lookingAwayFromScreen.enabled &&
            faces.length > 0
          ) {
            const { away, reason } = analyzeGaze(faces[0]);
            if (away) {
              if (++gazeAwayFrames >= MAX_GAZE_AWAY) {
                if (cooldowns.tryFire("looking_away_from_screen", gazeAwayCd))
                  fire("looking_away_from_screen", `Looking away: ${reason}`, {
                    reason,
                  });
              }
            } else {
              gazeAwayFrames = 0;
            }
          }
        });

        let lastFrameTime = 0;
        const loop = async () => {
          if (!isMounted) return;
          const now = Date.now();
          if (
            now - lastFrameTime >= FRAME_INTERVAL &&
            videoEl &&
            videoEl.readyState >= 2
          ) {
            lastFrameTime = now;
            try {
              await faceMesh.send({ image: videoEl });
            } catch {
              /* ignore */
            }
          }
          animId = requestAnimationFrame(loop);
        };
        loop();

        fallbackCleanup = () => {
          faceMesh.close();
          videoEl?.remove();
        };
      } catch (err) {
        console.warn(
          "[GazeDetector] MediaPipe runtime error – falling back:",
          err,
        );
        videoEl?.remove();
        videoEl = null;
        startBrightnessFallback();
      }
    };

    startWithMediaPipe();

    return () => {
      isMounted = false;
      cancelAnimationFrame(animId);
      fallbackCleanup?.();
    };
  }, [
    enabled,
    mediaStream,
    gazeEnabled,
    getCooldowns,
    incidentCooldowns,
    cooldownMs,
    fire,
  ]);
}

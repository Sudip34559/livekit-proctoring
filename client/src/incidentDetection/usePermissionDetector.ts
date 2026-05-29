import { useEffect, useRef } from "react";
import type { DetectionConfig, IncidentType } from "./types";
import { getCooldownMs } from "./config";
import { CooldownManager } from "./CooldownManager";

interface Options {
  enabled: boolean;
  config: DetectionConfig;
  getCooldowns: () => CooldownManager;
  fire: (
    type: IncidentType,
    message: string,
    meta?: Record<string, unknown>,
  ) => void;
  onPermissionStatesChanged?: (states: {
    cameraDenied: boolean;
    microphoneDenied: boolean;
  }) => void;
  onStreamRecoveryRequested?: (type: "camera" | "microphone") => void;
}

/**
 * Detects:
 *  - camera_disconnected    (permission revoked or stream error)
 *  - microphone_disabled    (permission revoked)
 *
 * Uses both `PermissionStatus.onchange` listeners (real-time) and a
 * 3-second polling fallback for browsers that don't fire the event.
 */
export function usePermissionDetector({
  enabled,
  config,
  getCooldowns,
  fire,
  onPermissionStatesChanged,
  onStreamRecoveryRequested,
}: Options) {
  const { incidentSettings, incidentCooldowns, cooldownMs } = config;
  const stateRef = useRef({ cameraDenied: false, microphoneDenied: false });
  const cooldowns = getCooldowns();
  useEffect(() => {
    if (!enabled) return;
    if (!navigator.permissions) return;

    let cameraStatus: PermissionStatus | null = null;
    let micStatus: PermissionStatus | null = null;
    let prevCamera: PermissionState | null = null;
    let prevMic: PermissionState | null = null;

    const camCd = getCooldownMs(
      "camera_disconnected",
      incidentCooldowns,
      cooldownMs,
    );
    const micCd = getCooldownMs(
      "microphone_disabled",
      incidentCooldowns,
      cooldownMs,
    );

    const handleCameraChange = (state: PermissionState) => {
      if (state === "denied" && prevCamera !== "denied") {
        if (cooldowns.tryFire("camera_disconnected", camCd))
          fire("camera_disconnected", "Camera permission denied", { state });
        const next = { ...stateRef.current, cameraDenied: true };
        stateRef.current = next;
        onPermissionStatesChanged?.(next);
      } else if (state === "granted" && prevCamera === "denied") {
        const next = { ...stateRef.current, cameraDenied: false };
        stateRef.current = next;
        onPermissionStatesChanged?.(next);
        onStreamRecoveryRequested?.("camera");
      }
      prevCamera = state;
    };

    const handleMicChange = (state: PermissionState) => {
      if (state === "denied" && prevMic !== "denied") {
        if (cooldowns.tryFire("microphone_disabled", micCd))
          fire("microphone_disabled", "Microphone permission denied", {
            state,
          });
        const next = { ...stateRef.current, microphoneDenied: true };
        stateRef.current = next;
        onPermissionStatesChanged?.(next);
      } else if (state === "granted" && prevMic === "denied") {
        const next = { ...stateRef.current, microphoneDenied: false };
        stateRef.current = next;
        onPermissionStatesChanged?.(next);
        onStreamRecoveryRequested?.("microphone");
      }
      prevMic = state;
    };

    // Bootstrap + attach listeners
    const setup = async () => {
      try {
        [cameraStatus, micStatus] = await Promise.all([
          navigator.permissions.query({ name: "camera" as PermissionName }),
          navigator.permissions.query({ name: "microphone" as PermissionName }),
        ]);

        // Initial state
        handleCameraChange(cameraStatus.state);
        handleMicChange(micStatus.state);

        // Real-time change listeners
        cameraStatus.onchange = () => handleCameraChange(cameraStatus!.state);
        micStatus.onchange = () => handleMicChange(micStatus!.state);
      } catch (err) {
        console.warn("[PermissionDetector] Permissions API unavailable:", err);
      }
    };

    setup();

    // Polling fallback (3 s) for browsers with broken onchange
    const id = setInterval(async () => {
      if (!navigator.permissions) return;
      try {
        const [cam, mic] = await Promise.all([
          navigator.permissions.query({ name: "camera" as PermissionName }),
          navigator.permissions.query({ name: "microphone" as PermissionName }),
        ]);
        if (cam.state !== prevCamera) handleCameraChange(cam.state);
        if (mic.state !== prevMic) handleMicChange(mic.state);
      } catch {
        /* empty */
      }
    }, 3_000);

    return () => {
      clearInterval(id);
      if (cameraStatus) cameraStatus.onchange = null;
      if (micStatus) micStatus.onchange = null;
    };
  }, [
    cooldownMs,
    cooldowns,
    enabled,
    fire,
    incidentCooldowns,
    incidentSettings.cameraDisconnected.enabled,
    incidentSettings.microphoneDisabled.enabled,
    onPermissionStatesChanged,
    onStreamRecoveryRequested,
  ]);
}

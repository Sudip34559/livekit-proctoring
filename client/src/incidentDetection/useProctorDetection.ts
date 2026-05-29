import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DetectionEvent,
  type DetectorStatus,
  type IncidentType,
  type UseProctorDetectionOptions,
  type UseProctorDetectionReturn,
} from "./types";
import {
  mergeConfig,
  generateId,
  getSeverityForType,
  isTypeEnabled,
} from "./config";
import { CooldownManager } from "./CooldownManager";
import { useWindowFocusDetector } from "./useWindowFocusDetector";
import { useNoiseDetector } from "./useNoiseDetector";
import { useGazeDetector } from "./useGazeDetector";
import { useObjectDetector } from "./useObjectDetector";
import { useScreenDetector } from "./useScreenDetector";
import { usePermissionDetector } from "./usePermissionDetector";
import { useConnectionDetector } from "./useConnectionDetector";

export function useProctorDetection({
  examId,
  participantIdentity,
  mediaStream,
  screenStream,
  isCameraEnabled = true,
  isMicrophoneEnabled = true,
  onIncident,
  config: configOverride = {},
}: UseProctorDetectionOptions): UseProctorDetectionReturn {
  // ── Config ────────────────────────────────────────────────────────────────
  // Stringify so useMemo only re-runs on actual value changes, not new object refs
  const configStr = JSON.stringify(configOverride);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const config = useMemo(() => mergeConfig(configOverride), [configStr]);

  // ── Stable cooldown manager – never changes after mount ──────────────────
  // We store it in a ref so sub-detectors can read it inside effects without
  // violating the "no ref.current during render" rule.
  const cooldownsRef = useRef<CooldownManager | null>(null);
  if (cooldownsRef.current === null) {
    cooldownsRef.current = new CooldownManager();
  }
  // Alias for use inside this hook only (effects, not render path)
  const getCooldowns = useCallback(() => cooldownsRef.current!, []);

  // ── Stable refs for values used inside callbacks ──────────────────────────
  const configRef = useRef(config);
  const identityRef = useRef(participantIdentity);
  const onIncidentRef = useRef(onIncident);

  useEffect(() => {
    configRef.current = config;
  }, [config]);
  useEffect(() => {
    identityRef.current = participantIdentity;
  }, [participantIdentity]);
  useEffect(() => {
    onIncidentRef.current = onIncident;
  }, [onIncident]);

  // ── Incident log ──────────────────────────────────────────────────────────
  const [incidents, setIncidents] = useState<DetectionEvent[]>([]);
  const [incidentCounts, setIncidentCounts] = useState<
    Record<IncidentType, number>
  >({} as Record<IncidentType, number>);

  // ── Detector-status is derived from config + stream presence ─────────────
  // Pure memo – no useEffect + setState cascade needed.
  const detectorStatus = useMemo<DetectorStatus>(() => {
    const s = config.incidentSettings;
    return {
      gaze:
        config.enabled &&
        !!mediaStream &&
        isCameraEnabled &&
        (s.lookingAwayFromScreen.enabled ||
          s.multipleFacesInFrontOfCamera.enabled ||
          s.noFaceFound.enabled),
      noise:
        config.enabled &&
        isMicrophoneEnabled &&
        !!mediaStream &&
        s.backgroundNoiseDetected.enabled,
      speech: config.enabled && isMicrophoneEnabled && s.speechDetected.enabled,
      object:
        config.enabled &&
        isCameraEnabled &&
        !!mediaStream &&
        s.unauthorizedObjectDetected.enabled,
      windowFocus:
        config.enabled &&
        (s.windowChanged.enabled || s.exitedTheFullScreen.enabled),
      screenShare: config.enabled && s.screenNotShared.enabled,
      multiScreen: config.enabled && s.secondScreenConnected.enabled,
      permissions:
        config.enabled &&
        (s.cameraDisconnected.enabled || s.microphoneDisabled.enabled),
      connection: config.enabled && s.connectionLost.enabled,
    };
  }, [config, mediaStream, isCameraEnabled, isMicrophoneEnabled]);

  // ── Central fire function ─────────────────────────────────────────────────
  // Reads from refs so it never needs to be recreated (stable identity).
  const fire = useCallback(
    (type: IncidentType, message: string, meta?: Record<string, unknown>) => {
      const cfg = configRef.current;
      if (!cfg.enabled) return;
      if (!isTypeEnabled(type, cfg.incidentSettings)) return;

      const event: DetectionEvent = {
        id: generateId(),
        type,
        severity: getSeverityForType(type, cfg.incidentSettings),
        message,
        metadata: { ...meta, participantIdentity: identityRef.current },
        timestamp: Date.now(),
      };

      setIncidents((prev) => [event, ...prev].slice(0, 500));
      setIncidentCounts((prev) => ({ ...prev, [type]: (prev[type] ?? 0) + 1 }));
      onIncidentRef.current?.(event);
    },
    // intentionally empty – we use refs for all volatile values
    [],
  );

  // ── Sub-detectors ─────────────────────────────────────────────────────────
  // Each hook receives only primitive / stable values; the ref is unwrapped
  // inside the hook's own effects (never in the render body here).

  useWindowFocusDetector({
    enabled: config.enabled,
    config,
    getCooldowns,
    fire,
  });

  useNoiseDetector({
    enabled: config.enabled && isMicrophoneEnabled && !!mediaStream,
    mediaStream,
    config,
    getCooldowns,
    fire,
  });

  useGazeDetector({
    enabled: config.enabled && isCameraEnabled && !!mediaStream,
    mediaStream,
    config,
    getCooldowns,
    fire,
  });

  useObjectDetector({
    enabled: config.enabled && isCameraEnabled && !!mediaStream,
    mediaStream,
    config,
    getCooldowns,
    fire,
  });

  useScreenDetector({
    enabled: config.enabled,
    screenStream,
    config,
    getCooldowns,
    fire,
  });

  usePermissionDetector({
    enabled: config.enabled,
    config,
    getCooldowns,
    fire,
  });

  useConnectionDetector({
    enabled: config.enabled,
    examId: examId ?? "",
    config,
    getCooldowns,
    fire,
  });

  // ── Public API ────────────────────────────────────────────────────────────

  const clearIncidents = useCallback(() => {
    setIncidents([]);
    setIncidentCounts({} as Record<IncidentType, number>);
  }, []);

  const triggerManual = useCallback((type: IncidentType, note?: string) => {
    const cfg = configRef.current;
    const event: DetectionEvent = {
      id: generateId(),
      type,
      severity: getSeverityForType(type, cfg.incidentSettings),
      message: note ?? `Manual flag: ${type.replace(/_/g, " ")}`,
      metadata: { manual: true, participantIdentity: identityRef.current },
      timestamp: Date.now(),
    };
    setIncidents((prev) => [event, ...prev].slice(0, 500));
    setIncidentCounts((prev) => ({ ...prev, [type]: (prev[type] ?? 0) + 1 }));
    onIncidentRef.current?.(event);
  }, []);

  return {
    incidents,
    clearIncidents,
    triggerManual,
    incidentCounts,
    detectorStatus,
  };
}

import type {
  DetectionConfig,
  IncidentCooldowns,
  IncidentSettings,
  IncidentSeverity,
  IncidentType,
  PartialDetectionConfig,
} from "./types";

// ─── Default incident settings ────────────────────────────────────────────────

export const DEFAULT_INCIDENT_SETTINGS: IncidentSettings = {
  lookingAwayFromScreen: { enabled: false, severity: "high" },
  backgroundNoiseDetected: { enabled: false, severity: "medium" },
  speechDetected: { enabled: false, severity: "medium" },
  unauthorizedObjectDetected: { enabled: false, severity: "high" },
  windowChanged: { enabled: false, severity: "high" },
  connectionLost: { enabled: false, severity: "critical" },
  screenNotShared: { enabled: false, severity: "high" },
  mobileCameraDisconnected: { enabled: false, severity: "high" },
  cameraDisconnected: { enabled: false, severity: "high" },
  multipleFacesInFrontOfCamera: { enabled: false, severity: "critical" },
  noFaceFound: { enabled: false, severity: "high" },
  secondScreenConnected: { enabled: false, severity: "medium" },
  exitedTheFullScreen: { enabled: false, severity: "medium" },
  microphoneDisabled: { enabled: false, severity: "medium" },
};

// ─── Default cooldowns (ms) ───────────────────────────────────────────────────

export const DEFAULT_COOLDOWNS: IncidentCooldowns = {
  lookingAwayFromScreen: 5_000,
  backgroundNoiseDetected: 3_000,
  speechDetected: 2_000,
  unauthorizedObjectDetected: 5_000,
  windowChanged: 2_000,
  connectionLost: 1_000,
  screenNotShared: 3_000,
  mobileCameraDisconnected: 3_000,
  cameraDisconnected: 3_000,
  multipleFacesInFrontOfCamera: 5_000,
  noFaceFound: 3_000,
  secondScreenConnected: 5_000,
  exitedTheFullScreen: 2_000,
  microphoneDisabled: 3_000,
};

// ─── Base config ──────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: DetectionConfig = {
  enabled: false,
  sensitivity: "medium",
  cooldownMs: 3_000,
  incidentCooldowns: DEFAULT_COOLDOWNS,
  incidentSettings: DEFAULT_INCIDENT_SETTINGS,
  frameRate: { base: 15, min: 3, max: 20 },
};

// ─── Merge helper ─────────────────────────────────────────────────────────────

export function mergeConfig(override: PartialDetectionConfig): DetectionConfig {
  return {
    ...DEFAULT_CONFIG,
    ...override,
    incidentCooldowns: {
      ...DEFAULT_COOLDOWNS,
      ...override.incidentCooldowns,
    },
    incidentSettings: {
      ...DEFAULT_INCIDENT_SETTINGS,
      ...override.incidentSettings,
    },
  };
}

// ─── Sensitivity → noise threshold ───────────────────────────────────────────

export function sensitivityToThreshold(s: "low" | "medium" | "high"): number {
  return s === "high" ? 0.015 : s === "medium" ? 0.024 : 0.032;
}

// ─── snake_case → camelCase key map ──────────────────────────────────────────

const TYPE_TO_SETTING_KEY: Record<IncidentType, keyof IncidentSettings> = {
  looking_away_from_screen: "lookingAwayFromScreen",
  background_noise_detected: "backgroundNoiseDetected",
  speech_detected: "speechDetected",
  unauthorized_object_detected: "unauthorizedObjectDetected",
  window_changed: "windowChanged",
  connection_lost: "connectionLost",
  screen_not_shared: "screenNotShared",
  mobile_camera_disconnected: "mobileCameraDisconnected",
  camera_disconnected: "cameraDisconnected",
  multiple_faces_in_front_of_camera: "multipleFacesInFrontOfCamera",
  no_face_found: "noFaceFound",
  second_screen_connected: "secondScreenConnected",
  exited_the_full_screen: "exitedTheFullScreen",
  microphone_disabled: "microphoneDisabled",
};

const TYPE_TO_COOLDOWN_KEY: Record<IncidentType, keyof IncidentCooldowns> = {
  looking_away_from_screen: "lookingAwayFromScreen",
  background_noise_detected: "backgroundNoiseDetected",
  speech_detected: "speechDetected",
  unauthorized_object_detected: "unauthorizedObjectDetected",
  window_changed: "windowChanged",
  connection_lost: "connectionLost",
  screen_not_shared: "screenNotShared",
  mobile_camera_disconnected: "mobileCameraDisconnected",
  camera_disconnected: "cameraDisconnected",
  multiple_faces_in_front_of_camera: "multipleFacesInFrontOfCamera",
  no_face_found: "noFaceFound",
  second_screen_connected: "secondScreenConnected",
  exited_the_full_screen: "exitedTheFullScreen",
  microphone_disabled: "microphoneDisabled",
};

export function getSettingKey(type: IncidentType): keyof IncidentSettings {
  return TYPE_TO_SETTING_KEY[type];
}

export function getCooldownKey(type: IncidentType): keyof IncidentCooldowns {
  return TYPE_TO_COOLDOWN_KEY[type];
}

export function getSeverityForType(
  type: IncidentType,
  settings: IncidentSettings,
): IncidentSeverity {
  return settings[TYPE_TO_SETTING_KEY[type]]?.severity ?? "medium";
}

export function isTypeEnabled(
  type: IncidentType,
  settings: IncidentSettings,
): boolean {
  return settings[TYPE_TO_SETTING_KEY[type]]?.enabled ?? false;
}

export function getCooldownMs(
  type: IncidentType,
  cooldowns: IncidentCooldowns,
  fallback: number,
): number {
  return cooldowns[TYPE_TO_COOLDOWN_KEY[type]] ?? fallback;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

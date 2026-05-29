export { useProctorDetection } from "./useProctorDetection";
export type {
  DetectionEvent,
  DetectionConfig,
  PartialDetectionConfig,
  IncidentType,
  IncidentSeverity,
  IncidentSettings,
  IncidentSetting,
  IncidentCooldowns,
  DetectorStatus,
  UseProctorDetectionOptions,
  UseProctorDetectionReturn,
} from "./types";
export {
  DEFAULT_CONFIG,
  DEFAULT_COOLDOWNS,
  DEFAULT_INCIDENT_SETTINGS,
  mergeConfig,
  sensitivityToThreshold,
} from "./config";
export { CooldownManager } from "./CooldownManager";

// Sub-detectors (for advanced / split usage)
export { useWindowFocusDetector } from "./useWindowFocusDetector";
export { useNoiseDetector } from "./useNoiseDetector";
export { useGazeDetector } from "./useGazeDetector";
export { useObjectDetector } from "./useObjectDetector";
export { useScreenDetector } from "./useScreenDetector";
export { usePermissionDetector } from "./usePermissionDetector";
export { useConnectionDetector } from "./useConnectionDetector";

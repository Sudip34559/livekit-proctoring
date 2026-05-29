// ─── Incident Types ───────────────────────────────────────────────────────────

export type IncidentType =
  | "looking_away_from_screen"
  | "background_noise_detected"
  | "speech_detected"
  | "unauthorized_object_detected"
  | "window_changed"
  | "connection_lost"
  | "screen_not_shared"
  | "mobile_camera_disconnected"
  | "camera_disconnected"
  | "multiple_faces_in_front_of_camera"
  | "no_face_found"
  | "second_screen_connected"
  | "exited_the_full_screen"
  | "microphone_disabled";

export type IncidentSeverity = "low" | "medium" | "high" | "critical";

export interface DetectionEvent {
  id: string;
  type: IncidentType;
  severity: IncidentSeverity;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

// ─── Per-Incident Settings ────────────────────────────────────────────────────

export interface IncidentSetting {
  enabled: boolean;
  severity: IncidentSeverity;
}

export interface IncidentSettings {
  lookingAwayFromScreen: IncidentSetting;
  backgroundNoiseDetected: IncidentSetting;
  speechDetected: IncidentSetting;
  unauthorizedObjectDetected: IncidentSetting;
  windowChanged: IncidentSetting;
  connectionLost: IncidentSetting;
  screenNotShared: IncidentSetting;
  mobileCameraDisconnected: IncidentSetting;
  cameraDisconnected: IncidentSetting;
  multipleFacesInFrontOfCamera: IncidentSetting;
  noFaceFound: IncidentSetting;
  secondScreenConnected: IncidentSetting;
  exitedTheFullScreen: IncidentSetting;
  microphoneDisabled: IncidentSetting;
}

// ─── Cooldowns ────────────────────────────────────────────────────────────────

export interface IncidentCooldowns {
  lookingAwayFromScreen: number;
  backgroundNoiseDetected: number;
  speechDetected: number;
  unauthorizedObjectDetected: number;
  windowChanged: number;
  connectionLost: number;
  screenNotShared: number;
  mobileCameraDisconnected: number;
  cameraDisconnected: number;
  multipleFacesInFrontOfCamera: number;
  noFaceFound: number;
  secondScreenConnected: number;
  exitedTheFullScreen: number;
  microphoneDisabled: number;
}

// ─── Main Config ──────────────────────────────────────────────────────────────

export interface DetectionConfig {
  enabled: boolean;
  sensitivity: "low" | "medium" | "high";
  cooldownMs: number;
  incidentCooldowns: IncidentCooldowns;
  incidentSettings: IncidentSettings;
  frameRate: { base: number; min: number; max: number };
}

export type PartialDetectionConfig = Partial<
  Omit<DetectionConfig, "incidentSettings" | "incidentCooldowns">
> & {
  incidentSettings?: Partial<IncidentSettings>;
  incidentCooldowns?: Partial<IncidentCooldowns>;
};

// ─── Hook Options ─────────────────────────────────────────────────────────────

export interface UseProctorDetectionOptions {
  /** Unique exam/session ID – used for reporting */
  examId: string;
  /** Participant identity string */
  participantIdentity: string;
  /** Camera + mic stream */
  mediaStream: MediaStream | null;
  /** Screen-share stream */
  screenStream: MediaStream | null;
  /** Whether the camera track is intentionally enabled by the user */
  isCameraEnabled?: boolean;
  /** Whether the mic track is intentionally enabled by the user */
  isMicrophoneEnabled?: boolean;
  /** Called every time a new incident fires */
  onIncident: (event: DetectionEvent) => void;
  /** Config overrides – merged onto defaults */
  config?: PartialDetectionConfig;
}

export interface UseProctorDetectionReturn {
  /** All incidents fired since the hook was mounted */
  incidents: DetectionEvent[];
  /** Clear the local incident log */
  clearIncidents: () => void;
  /** Programmatically fire an incident (e.g. manual proctor flag) */
  triggerManual: (type: IncidentType, note?: string) => void;
  /** Counts per incident type */
  incidentCounts: Record<IncidentType, number>;
  /** Whether each sub-detector is currently running */
  detectorStatus: DetectorStatus;
}

export interface DetectorStatus {
  gaze: boolean;
  noise: boolean;
  speech: boolean;
  object: boolean;
  windowFocus: boolean;
  screenShare: boolean;
  multiScreen: boolean;
  permissions: boolean;
  connection: boolean;
}

export interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;

  start(): void;
  stop(): void;

  onresult:
    | ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void)
    | null;
  onerror: ((this: SpeechRecognition, ev: Event) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

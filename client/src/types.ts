export interface Exam {
  id: string;
  title: string;
  duration: number;
  startTime?: string;
  status: "pending" | "active" | "completed";
  proctorId: string;
  roomName: string;
  e2eeKey: string;
}

export interface Participant {
  identity: string;
  name: string;
  examId: string;
  joinedAt: string;
  status: "waiting" | "active" | "flagged" | "removed";
}

export interface Incident {
  id: string;
  examId: string;
  participantIdentity: string;
  type:
    | "tab_switch"
    | "multiple_faces"
    | "no_face"
    | "phone_detected"
    | "manual_flag"
    | "audio_anomaly";
  severity: "low" | "medium" | "high";
  timestamp: string;
  note?: string;
}

export interface JoinResponse {
  token: string;
  livekitUrl: string;
  e2eeKey: string;
  exam: Exam;
}

export interface CreateExamResponse {
  exam: Exam;
  token: string;
  livekitUrl: string;
}

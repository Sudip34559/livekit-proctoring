import type {
  CreateExamResponse,
  Exam,
  Incident,
  JoinResponse,
  Participant,
} from "./types";

const BASE = "http://localhost:3001/api";

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error((err as { error?: string }).error ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Exams
  createExam: (data: {
    title: string;
    duration: number;
    proctorId: string;
    proctorName: string;
  }) =>
    req<CreateExamResponse>("/exams", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  listExams: () => req<Exam[]>("/exams"),

  getExam: (id: string) => req<Exam>(`/exams/${id}`),

  startExam: (id: string) => req<Exam>(`/exams/${id}/start`, { method: "PUT" }),

  endExam: (id: string) => req<Exam>(`/exams/${id}/end`, { method: "PUT" }),

  joinExam: (id: string, data: { name: string; identity: string }) =>
    req<JoinResponse>(`/exams/${id}/join`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  joinProctor: (id: string, data: { name: string; identity: string }) =>
    req<JoinResponse>(`/exams/${id}/join-proctor`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Participants
  getParticipants: (examId: string) =>
    req<Participant[]>(`/exams/${examId}/participants`),

  updateParticipant: (
    examId: string,
    identity: string,
    status: Participant["status"],
  ) =>
    req<Participant>(`/exams/${examId}/participants/${identity}`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    }),

  kickParticipant: (examId: string, identity: string) =>
    req<{ status: string }>(
      `/exams/${examId}/kick/${encodeURIComponent(identity)}`,
      {
        method: "POST",
      },
    ),

  // Incidents
  getIncidents: (examId: string) =>
    req<Incident[]>(`/exams/${examId}/incidents`),

  reportIncident: (examId: string, data: Omit<Incident, "id" | "timestamp">) =>
    req<Incident>(`/exams/${examId}/incidents`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Recording
  startRecording: (examId: string) =>
    req<{ egressId: string; status: string }>(
      `/exams/${examId}/recording/start`,
      { method: "POST" },
    ),

  stopRecording: (examId: string, egressId: string) =>
    req<{ status: string }>(`/exams/${examId}/recording/stop`, {
      method: "POST",
      body: JSON.stringify({ egressId }),
    }),
};

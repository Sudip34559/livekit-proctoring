import { create } from "zustand";
import type { Exam, Incident, Participant } from "./types";

interface AppStore {
  // Session
  role: "proctor" | "student" | null;
  identity: string;
  displayName: string;
  setSession: (
    role: "proctor" | "student",
    identity: string,
    name: string,
  ) => void;

  // Current exam session
  exam: Exam | null;
  token: string | null;
  livekitUrl: string | null;
  e2eeKey: string | null;
  setExamSession: (exam: Exam, token: string, url: string, key: string) => void;
  clearExamSession: () => void;

  // Proctor dashboard data
  participants: Participant[];
  incidents: Incident[];
  setParticipants: (p: Participant[]) => void;
  addIncident: (i: Incident) => void;
  setIncidents: (i: Incident[]) => void;

  // Recording
  egressId: string | null;
  isRecording: boolean;
  setRecording: (egressId: string | null, isRecording: boolean) => void;

  // UI
  selectedParticipant: string | null;
  setSelectedParticipant: (id: string | null) => void;
  sidebarTab: "participants" | "incidents" | "chat";
  setSidebarTab: (tab: "participants" | "incidents" | "chat") => void;
}

export const useAppStore = create<AppStore>((set) => ({
  role: null,
  identity: "",
  displayName: "",
  setSession: (role, identity, displayName) =>
    set({ role, identity, displayName }),

  exam: null,
  token: null,
  livekitUrl: null,
  e2eeKey: null,
  setExamSession: (exam, token, livekitUrl, e2eeKey) =>
    set({ exam, token, livekitUrl, e2eeKey }),
  clearExamSession: () =>
    set({ exam: null, token: null, livekitUrl: null, e2eeKey: null }),

  participants: [],
  incidents: [],
  setParticipants: (participants) => set({ participants }),
  addIncident: (incident) =>
    set((s) => ({ incidents: [incident, ...s.incidents] })),
  setIncidents: (incidents) => set({ incidents }),

  egressId: null,
  isRecording: false,
  setRecording: (egressId, isRecording) => set({ egressId, isRecording }),

  selectedParticipant: null,
  setSelectedParticipant: (selectedParticipant) => set({ selectedParticipant }),
  sidebarTab: "participants",
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
}));

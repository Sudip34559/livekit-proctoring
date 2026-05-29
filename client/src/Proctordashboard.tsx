import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useParticipants,
  VideoTrack,
  useTracks,
  TrackRefContext,
  type TrackReference,
} from "@livekit/components-react";
import { ExternalE2EEKeyProvider, Room, Track } from "livekit-client";
import type { RoomOptions } from "livekit-client";
import {
  ShieldCheck,
  Users,
  AlertTriangle,
  Square,
  Play,
  UserX,
  Clock,
  Copy,
  Check,
  Monitor,
  Camera,
  Signal,
} from "lucide-react";
import { useAppStore } from "./store";
import { api } from "./Api";
import type { Incident, Participant } from "./types";
import { formatDistanceToNow } from "date-fns";

export function ProctorDashboard() {
  const navigate = useNavigate();
  const {
    exam,
    token,
    livekitUrl,
    e2eeKey,
    participants,
    incidents,
    isRecording,
    sidebarTab,
    selectedParticipant,
    setParticipants,
    setIncidents,
    addIncident,
    setSidebarTab,
    setSelectedParticipant,
  } = useAppStore((s) => s);

  const [room, setRoom] = useState<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [examStarted, setExamStarted] = useState(exam?.status === "active");
  const [copied, setCopied] = useState(false);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [qualityLevel, setQualityLevel] = useState<"low" | "medium" | "high">(
    "high",
  );
  const [sendingQuality, setSendingQuality] = useState(false);

  useEffect(() => {
    if (!exam || !token || !e2eeKey) {
      navigate("/");
      return;
    }
  }, [exam, token, e2eeKey, navigate]);

  // Build E2EE room
  useEffect(() => {
    if (!e2eeKey) return;
    const keyProvider = new ExternalE2EEKeyProvider();
    const encoder = new TextEncoder();
    const keyData = encoder.encode(e2eeKey.padEnd(32, "0").substring(0, 32));
    keyProvider.setKey(String(keyData));

    const options: RoomOptions = {
      e2ee: {
        keyProvider,
        worker: new Worker(
          new URL("livekit-client/e2ee-worker", import.meta.url),
          { type: "module" },
        ),
      },
      adaptiveStream: true,
      dynacast: true,
    };

    const r = new Room(options);
    const timer = window.setTimeout(() => setRoom(r), 0);
    return () => {
      window.clearTimeout(timer);
      r.disconnect();
    };
  }, [e2eeKey]);

  // Poll participants & incidents
  useEffect(() => {
    if (!exam) return;
    const poll = async () => {
      try {
        const [p, i] = await Promise.all([
          api.getParticipants(exam.id),
          api.getIncidents(exam.id),
        ]);
        setParticipants(p);
        setIncidents(i);
      } catch {
        /* ignore */
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [exam, setParticipants, setIncidents]);

  // Timer
  useEffect(() => {
    if (!examStarted || !exam?.startTime) return;
    const start = new Date(exam.startTime).getTime();
    const id = setInterval(
      () => setTimeElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [examStarted, exam]);

  const sendQualityToAll = async (level: "low" | "medium" | "high") => {
    if (!room) return;
    setSendingQuality(true);
    try {
      const payload = new TextEncoder().encode(
        JSON.stringify({ type: "quality", level }),
      );
      // DataPublishOptions: reliable=true so no message is dropped
      await room.localParticipant.publishData(payload, { reliable: true });
      setQualityLevel(level);
    } catch (err) {
      console.error("[Proctor] Failed to send quality:", err);
    } finally {
      setSendingQuality(false);
    }
  };

  const handleStartExam = async () => {
    if (!exam) return;
    await api.startExam(exam.id);
    setExamStarted(true);
  };

  const handleEndExam = async () => {
    if (!exam) return;
    await api.endExam(exam.id);
    navigate("/");
  };

  const handleKick = async (identity: string) => {
    if (!exam) return;
    await api.kickParticipant(exam.id, identity);
    setParticipants(
      participants.map((p) =>
        p.identity === identity ? { ...p, status: "removed" } : p,
      ),
    );
  };

  const handleManualFlag = async (identity: string) => {
    if (!exam) return;
    const inc = await api.reportIncident(exam.id, {
      examId: exam.id,
      participantIdentity: identity,
      type: "manual_flag",
      severity: "medium",
      note: "Manually flagged by proctor",
    });
    addIncident(inc);
    setParticipants(
      participants.map((p) =>
        p.identity === identity ? { ...p, status: "flagged" } : p,
      ),
    );
  };

  const copyExamId = () => {
    if (!exam) return;
    navigator.clipboard.writeText(exam.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  if (!exam || !token || !room) return null;

  const flagged = participants.filter((p) => p.status === "flagged").length;
  const active = participants.filter(
    (p) => p.status === "active" || p.status === "flagged",
  ).length;
  const highIncidents = incidents.filter((i) => i.severity === "high").length;

  return (
    <div className="dashboard">
      {/* Top bar */}
      <header className="dash-header">
        <div className="dash-header-left">
          <ShieldCheck size={18} className="accent-icon" />
          <span className="dash-title">{exam.title}</span>
          <button
            className="exam-id-btn"
            onClick={copyExamId}
            title="Copy Exam ID"
          >
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
              {exam.id.split("-")[0]}...
            </span>
            {copied ? (
              <Check size={12} style={{ color: "var(--green)" }} />
            ) : (
              <Copy size={12} />
            )}
          </button>
        </div>

        <div className="dash-stats">
          <StatChip
            icon={<Users size={12} />}
            val={active}
            label="Active"
            color="blue"
          />
          <StatChip
            icon={<AlertTriangle size={12} />}
            val={flagged}
            label="Flagged"
            color={flagged > 0 ? "red" : "gray"}
          />
          <StatChip
            icon={<AlertTriangle size={12} />}
            val={highIncidents}
            label="High"
            color={highIncidents > 0 ? "yellow" : "gray"}
          />
          {examStarted && (
            <div className="stat-chip stat-timer">
              <Clock size={12} />
              <span style={{ fontFamily: "var(--font-mono)" }}>
                {formatElapsed(timeElapsed)}
              </span>
            </div>
          )}
        </div>

        <div className="dash-header-right">
          <div className="quality-control">
            <Signal size={13} className="accent-icon" />
            <select
              className="quality-select"
              value={qualityLevel}
              disabled={sendingQuality}
              onChange={(e) =>
                sendQualityToAll(e.target.value as "low" | "medium" | "high")
              }
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            {sendingQuality && (
              <span className="quality-sending">Sending…</span>
            )}
          </div>
          {isRecording && (
            <div className="rec-indicator recording-pulse">
              <span className="rec-dot" /> REC
            </div>
          )}
          {!examStarted ? (
            <button
              className="btn btn-success btn-sm"
              onClick={handleStartExam}
            >
              <Play size={13} /> Start Exam
            </button>
          ) : (
            <button className="btn btn-danger btn-sm" onClick={handleEndExam}>
              <Square size={13} /> End Exam
            </button>
          )}
        </div>
      </header>

      {/* Main layout */}
      <div className="dash-body">
        <div className="dash-main">
          <LiveKitRoom
            room={room}
            token={token}
            serverUrl={livekitUrl!}
            connect={true}
            audio={false}
            video={false}
            onConnected={() => setConnected(true)}
            onDisconnected={() => setConnected(false)}
          >
            <RoomAudioRenderer />
            <ParticipantGrid
              examId={exam.id}
              participants={participants}
              onKick={handleKick}
              onFlag={handleManualFlag}
              onSelect={setSelectedParticipant}
              selected={selectedParticipant}
            />
          </LiveKitRoom>
        </div>

        <aside className="dash-sidebar">
          <div className="sidebar-tabs">
            {(["participants", "incidents"] as const).map((tab) => (
              <button
                key={tab}
                className={`sidebar-tab ${sidebarTab === tab ? "active" : ""}`}
                onClick={() => setSidebarTab(tab)}
              >
                {tab === "participants" ? (
                  <Users size={13} />
                ) : (
                  <AlertTriangle size={13} />
                )}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === "incidents" && incidents.length > 0 && (
                  <span className="tab-badge">{incidents.length}</span>
                )}
              </button>
            ))}
          </div>
          <div className="sidebar-content">
            {sidebarTab === "participants" && (
              <ParticipantList
                participants={participants}
                onKick={handleKick}
                onFlag={handleManualFlag}
                onSelect={setSelectedParticipant}
                selected={selectedParticipant}
              />
            )}
            {sidebarTab === "incidents" && (
              <IncidentList incidents={incidents} />
            )}
          </div>
        </aside>
      </div>

      <style>{`
        .dashboard { height: 100vh; display: flex; flex-direction: column; background: var(--bg); }
        .dash-header {
          display: grid; grid-template-columns: 1fr auto 1fr;
          align-items: center; padding: 0 16px; height: 52px;
          background: var(--surface); border-bottom: 1px solid var(--border);
          flex-shrink: 0; z-index: 10; gap: 12px;
        }
        .dash-header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .dash-title {
          font-family: var(--font-display); font-size: 14px; font-weight: 700;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .exam-id-btn {
          display: flex; align-items: center; gap: 5px; background: var(--surface-2);
          border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px;
          color: var(--text-2); cursor: pointer; flex-shrink: 0; transition: all 0.15s;
        }
        .exam-id-btn:hover { background: var(--bg-3); color: var(--text); }
        .dash-stats { display: flex; align-items: center; gap: 8px; justify-content: center; flex-wrap: nowrap; }
        .stat-chip {
          display: flex; align-items: center; gap: 5px;
          padding: 4px 10px; border-radius: 20px;
          font-size: 12px; font-weight: 600; font-family: var(--font-mono);
          background: var(--surface-2); border: 1px solid var(--border);
          color: var(--text-2); white-space: nowrap;
        }
        .stat-chip-blue   { background: var(--accent-glow); color: var(--accent-2); border-color: rgba(59,130,246,0.2); }
        .stat-chip-red    { background: var(--red-bg); color: var(--red); border-color: rgba(239,68,68,0.2); }
        .stat-chip-yellow { background: var(--yellow-bg); color: var(--yellow); border-color: rgba(245,158,11,0.2); }
        .stat-timer { background: var(--bg-3); }
        .dash-header-right { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
        .rec-indicator {
          display: flex; align-items: center; gap: 6px;
          background: var(--red-bg); border: 1px solid rgba(239,68,68,0.3);
          color: var(--red); border-radius: 20px; padding: 4px 12px;
          font-size: 11px; font-weight: 700; font-family: var(--font-mono); letter-spacing: 0.1em;
        }
        .rec-dot { width: 7px; height: 7px; background: var(--red); border-radius: 50%; animation: blink 1s ease infinite; }
        .dash-body { flex: 1; display: grid; grid-template-columns: 1fr 280px; overflow: hidden; }
        .dash-main { overflow: hidden; position: relative; }
        .dash-main .lk-room-container { height: 100% !important; }
        .dash-sidebar {
          background: var(--surface); border-left: 1px solid var(--border);
          display: flex; flex-direction: column; overflow: hidden;
        }
        .sidebar-tabs { display: flex; border-bottom: 1px solid var(--border); padding: 0 4px; flex-shrink: 0; }
        .sidebar-tab {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
          padding: 10px 8px; background: none; border: none; cursor: pointer;
          color: var(--text-2); font-size: 12px; font-weight: 500;
          font-family: var(--font-body); transition: all 0.15s;
          border-bottom: 2px solid transparent; margin-bottom: -1px;
        }
        .sidebar-tab:hover { color: var(--text); }
        .sidebar-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
        .tab-badge {
          background: var(--red); color: #fff; border-radius: 10px;
          padding: 1px 6px; font-size: 10px; font-weight: 700;
        }
        .sidebar-content { flex: 1; overflow-y: auto; padding: 12px; }

        .quality-control {
            display: flex;
            align-items: center;
            gap: 6px;
            background: var(--bg-3);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 4px 10px;
          }

          .quality-select {
            background: transparent;
            border: none;
            color: var(--text);
            font-size: 12px;
            font-family: var(--font-display);
            font-weight: 600;
            cursor: pointer;
            outline: none;
            appearance: none;          /* hide default OS arrow */
            padding-right: 14px;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 0 center;
          }

          .quality-select:disabled {
            opacity: 0.5;
            cursor: wait;
          }

          .quality-select option {
            background: var(--surface);
            color: var(--text);
          }

          .quality-sending {
            font-size: 11px;
            color: var(--text-2);
            animation: blink 0.8s ease infinite;
          }
      `}</style>
    </div>
  );
}

// ── Participant Grid ──────────────────────────────────────────────────────────
function ParticipantGrid({
  participants,
  onKick,
  onFlag,
  onSelect,
  selected,
}: {
  examId: string;
  participants: Participant[];
  onKick: (id: string) => void;
  onFlag: (id: string) => void;
  onSelect: (id: string | null) => void;
  selected: string | null;
}) {
  const livekitParticipants = useParticipants();

  // Collect all remote tracks for camera AND screen share
  const allTracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], {
    onlySubscribed: true,
  });

  const remoteParticipants = livekitParticipants.filter(
    (p) => !p.isLocal && p.identity.startsWith("student-"),
  );

  if (remoteParticipants.length === 0) {
    return (
      <div className="grid-empty">
        <Users size={40} color="var(--text-3)" />
        <p>Waiting for participants to join...</p>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>
          Share your Exam ID with students
        </span>
      </div>
    );
  }

  return (
    <div className="participant-grid">
      {remoteParticipants.map((participant) => {
        // Separate camera and screen-share tracks for this participant
        const cameraTrack = allTracks.find(
          (t) =>
            t.participant.identity === participant.identity &&
            t.source === Track.Source.Camera,
        );
        const screenTrack = allTracks.find(
          (t) =>
            t.participant.identity === participant.identity &&
            t.source === Track.Source.ScreenShare,
        );

        const pData = participants.find(
          (p) => p.identity === participant.identity,
        );
        const isFlagged = pData?.status === "flagged";
        const isSelected = selected === participant.identity;

        return (
          <StudentTile
            key={participant.identity}
            identity={participant.identity}
            displayName={participant.name}
            cameraTrack={cameraTrack}
            screenTrack={screenTrack}
            isFlagged={isFlagged}
            isSelected={isSelected}
            onSelect={() => onSelect(isSelected ? null : participant.identity)}
            onKick={onKick}
            onFlag={onFlag}
          />
        );
      })}

      <style>{`
        .grid-empty {
          height: 100%; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 10px;
          color: var(--text-2); font-size: 14px;
        }
        .participant-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 8px; padding: 12px; align-content: start;
          height: 100%; overflow-y: auto;
        }
      `}</style>
    </div>
  );
}

// ── Student Tile ──────────────────────────────────────────────────────────────
/**
 * Layout per student:
 *
 *  ┌─────────────────────────────┐
 *  │                             │
 *  │   Screen share (main)       │  ← 16:9, fills tile
 *  │   or "no screen" placeholder│
 *  │                      ┌────┐ │
 *  │                      │cam │ │  ← camera PiP, bottom-right
 *  │                      └────┘ │
 *  ├─────────────────────────────┤
 *  │ Name  [screen icon] [cam]   │  ← footer with source indicators
 *  └─────────────────────────────┘
 *
 * If there is no screen share, the camera fills the whole tile (no PiP).
 */
function StudentTile({
  identity,
  displayName,
  cameraTrack,
  screenTrack,
  isFlagged,
  isSelected,
  onSelect,
  onKick,
  onFlag,
}: {
  identity: string;
  displayName: string;
  cameraTrack?: TrackReference;
  screenTrack?: TrackReference;
  isFlagged: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onKick: (id: string) => void;
  onFlag: (id: string) => void;
}) {
  const [primarySource, setPrimarySource] = useState<"screen" | "camera">(
    "screen",
  );

  const hasScreen = !!screenTrack;
  const hasCamera = !!cameraTrack;

  // Resolve which track is main and which is PiP based on user's choice
  const primaryTrack =
    primarySource === "screen"
      ? (screenTrack ?? cameraTrack)
      : (cameraTrack ?? screenTrack);

  const pipTrack =
    primarySource === "screen"
      ? hasScreen
        ? cameraTrack
        : undefined
      : hasCamera
        ? screenTrack
        : undefined;

  const primaryIsScreen = primarySource === "screen" ? hasScreen : false;

  // When screen share disappears, reset so next share auto-promotes
  useEffect(() => {
    if (!screenTrack) setPrimarySource("screen");
  }, [screenTrack]);

  return (
    <div
      className={`grid-tile ${isSelected ? "tile-selected" : ""} ${isFlagged ? "tile-flagged" : ""}`}
      onClick={onSelect}
    >
      {/* ── Primary video area ── */}
      <div className="tile-main-video">
        {primaryTrack ? (
          <TrackRefContext.Provider value={primaryTrack}>
            <VideoTrack
              trackRef={primaryTrack}
              style={{ transform: primaryIsScreen ? "none" : "scaleX(-1)" }}
            />
          </TrackRefContext.Provider>
        ) : (
          <div className="no-video">
            <Users size={20} color="var(--text-3)" />
            <span
              style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}
            >
              No video
            </span>
          </div>
        )}

        {/* ── Camera / Screen PiP ── */}
        {pipTrack && (
          <div className="tile-pip">
            <TrackRefContext.Provider value={pipTrack}>
              <VideoTrack
                trackRef={pipTrack}
                style={{
                  transform: primarySource === "screen" ? "scaleX(-1)" : "none",
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            </TrackRefContext.Provider>
          </div>
        )}

        {/* ── Source indicator badges (top-left, clickable) ── */}
        <div className="tile-source-badges">
          {hasScreen && (
            <span
              className={`source-badge source-screen ${
                primarySource === "screen" ? "badge-active" : "badge-inactive"
              }`}
              title="Switch to screen share"
              onClick={(e) => {
                e.stopPropagation();
                setPrimarySource("screen");
              }}
            >
              <Monitor size={9} /> Screen
            </span>
          )}
          {hasCamera && (
            <span
              className={`source-badge source-cam ${
                primarySource === "camera" ? "badge-active" : "badge-inactive"
              }`}
              title="Switch to camera"
              onClick={(e) => {
                e.stopPropagation();
                setPrimarySource("camera");
              }}
            >
              <Camera size={9} />
              {hasScreen && <span style={{ marginLeft: 3 }}>Cam</span>}
            </span>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="tile-footer">
        <span className="tile-name">{displayName}</span>
        {isFlagged && (
          <span className="badge badge-red" style={{ fontSize: 9 }}>
            !
          </span>
        )}
      </div>

      {/* ── Proctor action buttons (visible when tile is selected) ── */}
      {isSelected && (
        <div className="tile-actions">
          <button
            className="btn btn-danger btn-sm btn-icon"
            title="Kick"
            onClick={(e) => {
              e.stopPropagation();
              onKick(identity);
            }}
          >
            <UserX size={12} />
          </button>
          <button
            className="btn btn-ghost btn-sm btn-icon"
            title="Flag"
            onClick={(e) => {
              e.stopPropagation();
              onFlag(identity);
            }}
          >
            <AlertTriangle size={12} />
          </button>
        </div>
      )}

      <style>{`
        .grid-tile {
          position: relative; border-radius: var(--radius);
          border: 2px solid var(--border); overflow: hidden;
          cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s;
          background: var(--bg-3);
          display: flex; flex-direction: column;
        }
        .grid-tile:hover { border-color: var(--border-2); }
        .tile-selected { border-color: var(--accent) !important; box-shadow: 0 0 0 2px var(--accent-glow); }
        .tile-flagged  { border-color: rgba(239,68,68,0.5) !important; }

        /* Main video: 16:9 */
        .tile-main-video {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 9;
          background: #000;
          overflow: hidden;
          flex-shrink: 0;
        }
        .tile-main-video video {
          width: 100%; height: 100%; object-fit: cover; display: block;
        }
        .no-video {
          width: 100%; height: 100%; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
        }

        /* PiP overlay */
        .tile-pip {
          position: absolute;
          bottom: 6px; right: 6px;
          width: 56px; height: 42px;
          border-radius: 4px; overflow: hidden;
          border: 1.5px solid rgba(255,255,255,0.25);
          box-shadow: 0 2px 8px rgba(0,0,0,0.5);
          background: #111;
          z-index: 2;
        }

        /* Source badges */
        .tile-source-badges {
          position: absolute; top: 5px; left: 5px;
          display: flex; gap: 4px; z-index: 3;
        }
        .source-badge {
          display: flex; align-items: center; gap: 3px;
          padding: 2px 5px; border-radius: 4px;
          font-size: 9px; font-weight: 700; letter-spacing: 0.02em;
          backdrop-filter: blur(4px);
          cursor: pointer;
          user-select: none;
          transition: opacity 0.15s, transform 0.1s, box-shadow 0.15s;
        }
        .source-badge:hover { transform: scale(1.08); }
        .source-screen { background: rgba(59,130,246,0.75); color: #fff; }
        .source-cam    { background: rgba(0,0,0,0.55); color: rgba(255,255,255,0.85); }

        /* Active = currently the primary view */
        .badge-active {
          opacity: 1;
          box-shadow: 0 0 0 1.5px rgba(255,255,255,0.55);
        }
        /* Inactive = currently in PiP */
        .badge-inactive {
          opacity: 0.4;
        }
        .badge-inactive:hover { opacity: 0.85; }

        /* Footer */
        .tile-footer {
          display: flex; align-items: center; justify-content: space-between;
          padding: 5px 8px;
          background: var(--surface);
          border-top: 1px solid var(--border);
          flex-shrink: 0;
        }
        .tile-name { font-size: 11px; font-weight: 600; color: var(--text); }

        /* Action buttons */
        .tile-actions {
          position: absolute; top: 6px; right: 6px;
          display: flex; gap: 4px; z-index: 4;
        }
      `}</style>
    </div>
  );
}

// ── Participant List ──────────────────────────────────────────────────────────
function ParticipantList({
  participants,
  onKick,
  onFlag,
  onSelect,
  selected,
}: {
  participants: Participant[];
  onKick: (id: string) => void;
  onFlag: (id: string) => void;
  onSelect: (id: string | null) => void;
  selected: string | null;
}) {
  if (participants.length === 0) {
    return (
      <div
        style={{
          color: "var(--text-3)",
          fontSize: 12,
          textAlign: "center",
          padding: "24px 0",
        }}
      >
        No participants yet
      </div>
    );
  }
  return (
    <div className="plist">
      {participants.map((p) => (
        <div
          key={p.identity}
          className={`plist-item ${selected === p.identity ? "plist-selected" : ""}`}
          onClick={() => onSelect(selected === p.identity ? null : p.identity)}
        >
          <div className="plist-info">
            <div className="plist-avatar">{p.name[0]?.toUpperCase()}</div>
            <div>
              <div className="plist-name">{p.name}</div>
              <div className="plist-meta">
                {formatDistanceToNow(new Date(p.joinedAt), { addSuffix: true })}
              </div>
            </div>
          </div>
          <div className="plist-status">
            <StatusBadge status={p.status} />
          </div>
          {selected === p.identity && (
            <div className="plist-actions">
              <button
                className="btn btn-danger btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onKick(p.identity);
                }}
              >
                <UserX size={11} /> Kick
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onFlag(p.identity);
                }}
              >
                <AlertTriangle size={11} /> Flag
              </button>
            </div>
          )}
        </div>
      ))}
      <style>{`
        .plist { display: flex; flex-direction: column; gap: 4px; }
        .plist-item {
          padding: 10px; border-radius: var(--radius); cursor: pointer;
          border: 1px solid transparent; transition: all 0.15s; background: var(--bg-3);
        }
        .plist-item:hover { background: var(--surface-2); }
        .plist-selected { border-color: var(--accent) !important; background: var(--accent-glow) !important; }
        .plist-info { display: flex; align-items: center; gap: 8px; }
        .plist-avatar {
          width: 28px; height: 28px; border-radius: 50%; background: var(--surface-2);
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 700; color: var(--accent); flex-shrink: 0;
        }
        .plist-name { font-size: 13px; font-weight: 500; }
        .plist-meta { font-size: 11px; color: var(--text-3); font-family: var(--font-mono); }
        .plist-status { margin-top: 6px; }
        .plist-actions { display: flex; gap: 6px; margin-top: 8px; }
      `}</style>
    </div>
  );
}

// ── Incident List ─────────────────────────────────────────────────────────────
function IncidentList({ incidents }: { incidents: Incident[] }) {
  if (incidents.length === 0) {
    return (
      <div
        style={{
          color: "var(--text-3)",
          fontSize: 12,
          textAlign: "center",
          padding: "24px 0",
        }}
      >
        No incidents reported
      </div>
    );
  }
  return (
    <div className="ilist">
      {incidents.map((inc) => (
        <div key={inc.id} className={`ilist-item severity-${inc.severity}`}>
          <div className="ilist-header">
            <span
              className={`badge badge-${inc.severity === "high" ? "red" : inc.severity === "medium" ? "yellow" : "gray"}`}
            >
              {inc.severity}
            </span>
            <span className="ilist-time">
              {formatDistanceToNow(new Date(inc.timestamp), {
                addSuffix: true,
              })}
            </span>
          </div>
          <div className="ilist-type">{inc.type.replace(/_/g, " ")}</div>
          <div className="ilist-who">
            {inc.participantIdentity.replace(/^student-\d+-?/, "") ||
              inc.participantIdentity}
          </div>
          {inc.note && <div className="ilist-note">{inc.note}</div>}
        </div>
      ))}
      <style>{`
        .ilist { display: flex; flex-direction: column; gap: 6px; }
        .ilist-item { padding: 10px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg-3); }
        .severity-high   { border-left: 3px solid var(--red); }
        .severity-medium { border-left: 3px solid var(--yellow); }
        .severity-low    { border-left: 3px solid var(--text-3); }
        .ilist-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; }
        .ilist-time   { font-size: 10px; color: var(--text-3); font-family: var(--font-mono); }
        .ilist-type   { font-size: 12px; font-weight: 600; text-transform: capitalize; margin-bottom: 3px; }
        .ilist-who    { font-size: 11px; color: var(--text-2); font-family: var(--font-mono); }
        .ilist-note   { font-size: 11px; color: var(--text-3); margin-top: 4px; }
      `}</style>
    </div>
  );
}

// ── Shared small components ───────────────────────────────────────────────────
function StatChip({
  icon,
  val,
  label,
  color,
}: {
  icon: React.ReactNode;
  val: number;
  label: string;
  color: string;
}) {
  return (
    <div className={`stat-chip stat-chip-${color}`}>
      {icon}
      <span>{val}</span>
      <span style={{ fontWeight: 400, fontSize: 10 }}>{label}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: Participant["status"] }) {
  const map: Record<Participant["status"], string> = {
    waiting: "badge-gray",
    active: "badge-green",
    flagged: "badge-red",
    removed: "badge-yellow",
  };
  return <span className={`badge ${map[status]}`}>{status}</span>;
}

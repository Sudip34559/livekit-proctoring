import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
  useRoomContext,
} from "@livekit/components-react";
import {
  ExternalE2EEKeyProvider,
  Participant,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import { ConnectionQuality, type RoomOptions } from "livekit-client";
import { ShieldCheck, Clock, AlertTriangle, Wifi } from "lucide-react";
import { useAppStore } from "./store";
import { api } from "./Api";
import { useProctorDetection, type DetectionEvent } from "./incidentDetection";

export function ProctoredExam() {
  const navigate = useNavigate();
  const exam = useAppStore((s) => s.exam);
  const token = useAppStore((s) => s.token);
  const livekitUrl = useAppStore((s) => s.livekitUrl);
  const e2eeKey = useAppStore((s) => s.e2eeKey);
  const identity = useAppStore((s) => s.identity);

  const [room, setRoom] = useState<Room | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [connected, setConnected] = useState(false);
  const proctorQualityRef = useRef<"low" | "medium" | "high">("high"); // proctor's requested ceiling
  const currentAppliedRef = useRef<"low" | "medium" | "high">("high"); // what's actually applied
  const networkQualityRef = useRef<ConnectionQuality>(
    ConnectionQuality.Excellent,
  );

  const PRESETS = {
    low: {
      camera: { resolution: { width: 320, height: 180 }, frameRate: 15 },
      screen: { resolution: { width: 1280, height: 720 }, frameRate: 5 },
    },
    medium: {
      camera: { resolution: { width: 640, height: 360 }, frameRate: 20 },
      screen: { resolution: { width: 1600, height: 900 }, frameRate: 8 },
    },
    high: {
      camera: { resolution: { width: 1280, height: 720 }, frameRate: 24 },
      screen: { resolution: { width: 1920, height: 1080 }, frameRate: 12 },
    },
  } as const;
  // ─── quality rank for comparison ─────────────────────────────────────────────
  const RANK = { low: 0, medium: 1, high: 2 } as const;

  async function applyQuality(room: Room, level: "low" | "medium" | "high") {
    const preset = PRESETS[level];

    // ── 1. Camera: applyConstraints (no track restart, no encodings touch) ──
    const cameraTrack = room.localParticipant.getTrackPublication(
      Track.Source.Camera,
    )?.videoTrack;

    if (cameraTrack) {
      try {
        await cameraTrack.mediaStreamTrack.applyConstraints({
          width: { ideal: preset.camera.resolution.width },
          height: { ideal: preset.camera.resolution.height },
          frameRate: { ideal: preset.camera.frameRate },
        });
      } catch (e) {
        console.warn("[Quality] camera applyConstraints failed", e);
      }
    }

    // ── 2. Screen share: applyConstraints ONLY — never restartTrack!
    //    restartTrack calls getDisplayMedia() → re-prompt + blank screen ──
    const screenTrack = room.localParticipant.getTrackPublication(
      Track.Source.ScreenShare,
    )?.videoTrack;

    if (screenTrack) {
      try {
        await screenTrack.mediaStreamTrack.applyConstraints({
          width: { ideal: preset.screen.resolution.width },
          height: { ideal: preset.screen.resolution.height },
          frameRate: { ideal: preset.screen.frameRate },
        });
      } catch (e) {
        console.warn("[Quality] screen applyConstraints failed", e);
      }
    }

    // ── 3. Cap bitrate on all video senders (works alongside simulcast) ──
    const maxBitrate: Record<string, number> = {
      low: 150_000, // 150 kbps
      medium: 600_000, // 600 kbps
      high: 2_500_000, // 2.5 Mbps
    };

    try {
      const pc = (room as any).engine?.pcManager?.publisher?.pc as
        | RTCPeerConnection
        | undefined;

      if (pc) {
        await Promise.all(
          pc
            .getSenders()
            .filter((s) => s.track?.kind === "video")
            .map(async (sender) => {
              const params = sender.getParameters();
              if (!params.encodings?.length) return;

              // Keep relative simulcast ratios but cap the ceiling
              params.encodings.forEach((enc) => {
                enc.maxBitrate = maxBitrate[level];
              });

              await sender
                .setParameters(params)
                .catch((e) =>
                  console.warn("[Quality] setParameters failed", e),
                );
            }),
        );
      }
    } catch (e) {
      console.warn("[Quality] bitrate cap failed", e);
    }

    currentAppliedRef.current = level;
    console.log(`[Quality] Applied: ${level}`);
  }
  // ─── resolve effective quality: proctor ceiling + network floor ───────────────
  function resolveEffectiveQuality(
    proctorLevel: "low" | "medium" | "high",
    networkQuality: ConnectionQuality,
  ): "low" | "medium" | "high" {
    const networkIsPoor =
      networkQuality === ConnectionQuality.Poor ||
      networkQuality === ConnectionQuality.Lost;
    if (networkIsPoor) {
      // Downgrade: take min(proctorLevel, "low")
      return RANK[proctorLevel] > RANK["low"] ? "low" : proctorLevel;
    }
    // Network is fine → honour proctor's requested level exactly
    return proctorLevel;
  }

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
    const data = String(keyData);

    keyProvider.setKey(data);

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

  // Countdown timer
  useEffect(() => {
    if (!exam) return;
    const startMs = exam.startTime
      ? new Date(exam.startTime).getTime()
      : Date.now();
    const endMs = startMs + exam.duration * 60 * 1000;

    const tick = () => {
      const remaining = Math.max(0, endMs - Date.now());
      setTimeLeft(Math.floor(remaining / 1000));
      if (remaining <= 0) navigate("/");
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [exam, navigate]);

  useEffect(() => {
    if (!room) return;

    // ── 1. PROCTOR DATA CHANNEL ─────────────────────────────────────────────
    const onData = async (payload: Uint8Array) => {
      const msg = JSON.parse(new TextDecoder().decode(payload));
      if (msg.type !== "quality") return;

      const requested = msg.level as "low" | "medium" | "high";
      if (!PRESETS[requested]) return;

      console.log("...........data", msg);

      proctorQualityRef.current = requested;

      const effective = resolveEffectiveQuality(
        requested,
        networkQualityRef.current,
      );
      await applyQuality(room, effective);
    };

    // ── 2. NETWORK QUALITY (LiveKit events — fast reaction) ──────────────────
    const onConnectionQualityChanged = async (
      quality: ConnectionQuality,
      participant: Participant,
    ) => {
      // Only react to local participant's quality changes
      if (participant !== room.localParticipant) return;

      networkQualityRef.current = quality;

      const effective = resolveEffectiveQuality(
        proctorQualityRef.current,
        quality,
      );

      if (effective !== currentAppliedRef.current) {
        console.log(
          `[Quality] Network changed to ${quality} → adjusting to ${effective}`,
        );
        await applyQuality(room, effective);
      }
    };

    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ConnectionQualityChanged, onConnectionQualityChanged);

    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ConnectionQualityChanged, onConnectionQualityChanged);
    };
  }, [room]);

  useEffect(() => {
    if (!room) return;

    const POLL_MS = 5_000; // check every 5s

    const interval = window.setInterval(async () => {
      const pc = (room as any).engine?.pcManager?.publisher?.pc as
        | RTCPeerConnection
        | undefined;
      if (!pc) return;

      const stats = await pc.getStats();
      let totalPacketsLost = 0;
      let totalPacketsSent = 0;

      stats.forEach((report) => {
        if (report.type === "outbound-rtp" && report.kind === "video") {
          totalPacketsLost += report.packetsLost ?? 0;
          totalPacketsSent += report.packetsSent ?? 0;
        }
      });

      if (totalPacketsSent === 0) return;

      const lossRate = totalPacketsLost / totalPacketsSent;
      const networkIsPoor = lossRate > 0.05; // >5% loss = poor

      // Synthesise a quality signal and feed into the same logic
      const syntheticQuality = networkIsPoor
        ? ConnectionQuality.Poor
        : ConnectionQuality.Excellent;

      if (syntheticQuality !== networkQualityRef.current) {
        networkQualityRef.current = syntheticQuality;
        const effective = resolveEffectiveQuality(
          proctorQualityRef.current,
          syntheticQuality,
        );
        if (effective !== currentAppliedRef.current) {
          await applyQuality(room, effective);
        }
      }
    }, POLL_MS);

    return () => window.clearInterval(interval);
  }, [room]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  if (!exam || !token || !room || !e2eeKey) return null;

  return (
    <div className="exam-page">
      {/* Top bar */}
      <div className="exam-topbar">
        <div className="exam-topbar-left">
          <ShieldCheck size={16} className="accent-icon" />
          <span className="exam-title">{exam.title}</span>
          <span className="badge badge-green">
            <ShieldCheck size={10} />
            E2EE
          </span>
        </div>
        <div className="exam-topbar-center">
          <div className={`timer ${timeLeft < 300 ? "timer-warn" : ""}`}>
            <Clock size={14} />
            {formatTime(timeLeft)}
          </div>
        </div>
        <div className="exam-topbar-right">
          <span
            className={`connection-dot ${connected ? "dot-green" : "dot-yellow"}`}
          />
          <Wifi size={13} />
          <span style={{ fontSize: 12, color: "var(--text-2)" }}>
            {connected ? "Live" : "Connecting..."}
          </span>
        </div>
      </div>

      {/* LiveKit Room */}
      <div className="exam-room">
        <LiveKitRoom
          room={room}
          token={token}
          serverUrl={livekitUrl!}
          connect={true}
          audio={true}
          video={true}
          screen={true}
          onConnected={() => setConnected(true)}
          onDisconnected={() => setConnected(false)}
        >
          <RoomAudioRenderer />
          <DetectionWrapper examId={exam.id} identity={identity} />
          <VideoConference />
        </LiveKitRoom>
      </div>

      {/* Warning overlay when low time */}
      {timeLeft < 120 && timeLeft > 0 && (
        <div className="time-warning animate-in">
          <AlertTriangle size={14} />
          Less than 2 minutes remaining!
        </div>
      )}

      <style>{`
        .exam-page {
          height: 100vh; display: flex; flex-direction: column;
          background: var(--bg);
        }
        .exam-topbar {
          display: grid; grid-template-columns: 1fr auto 1fr;
          align-items: center; padding: 0 20px; height: 52px;
          background: var(--surface); border-bottom: 1px solid var(--border);
          flex-shrink: 0; z-index: 10;
        }
        .exam-topbar-left { display: flex; align-items: center; gap: 10px; }
        .exam-title { font-family: var(--font-display); font-size: 14px; font-weight: 700; }
        .exam-topbar-center { display: flex; justify-content: center; }
        .exam-topbar-right { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }

        .timer {
          display: flex; align-items: center; gap: 6px;
          font-family: var(--font-mono); font-size: 18px; font-weight: 600; color: var(--text);
          background: var(--bg-3); border: 1px solid var(--border);
          padding: 6px 16px; border-radius: 8px;
        }
        .timer-warn { color: var(--red); border-color: rgba(239,68,68,0.3); animation: blink 1s ease infinite; }

        .connection-dot {
          width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
        }
        .dot-green { background: var(--green); }
        .dot-yellow { background: var(--yellow); }

        .exam-room { flex: 1; overflow: hidden; }
        .exam-room .lk-room-container { height: 100%; }

        .time-warning {
          position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
          background: var(--red-bg); border: 1px solid rgba(239,68,68,0.3);
          color: var(--red); border-radius: var(--radius); padding: 10px 20px;
          display: flex; align-items: center; gap: 8px;
          font-size: 13px; font-weight: 600; z-index: 100;
        }
      `}</style>
    </div>
  );
}

// ── Detection wrapper (lives inside LiveKitRoom to access room context) ───────
function DetectionWrapper({
  examId,
  identity,
}: {
  examId: string;
  identity: string;
}) {
  const room = useRoomContext();
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [screenStream] = useState<MediaStream | null>(null); // screen share optional in student view

  // Grab the local camera/mic stream once connected
  useEffect(() => {
    const acquire = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        mediaStreamRef.current = s;
        setMediaStream(s);
      } catch {
        /* camera not available */
      }
    };

    if (room.state === "connected") acquire();
    room.on("connected", acquire);
    return () => {
      room.off("connected", acquire);
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [room]);

  const handleIncident = async (event: DetectionEvent) => {
    try {
      // Map DetectionEvent → server Incident shape
      await api.reportIncident(examId, {
        examId,
        participantIdentity: identity,
        type: event.type as Parameters<typeof api.reportIncident>[1]["type"],
        severity: event.severity as Parameters<
          typeof api.reportIncident
        >[1]["severity"],
        note: event.message,
      });
    } catch (err) {
      console.error("[DetectionWrapper] failed to report incident:", err);
    }
  };

  const { detectorStatus } = useProctorDetection({
    examId,
    participantIdentity: identity,
    mediaStream,
    screenStream,
    isCameraEnabled: true,
    isMicrophoneEnabled: true,
    onIncident: handleIncident,
  });

  // Debug overlay (remove in production)

  const active = Object.entries(detectorStatus)
    .filter(([, v]) => v)
    .map(([k]) => k);
  console.debug("[Detectors active]", active.join(", ") || "none");

  return null;
}

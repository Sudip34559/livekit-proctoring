import {
  AccessToken,
  EgressClient,
  EncodedFileOutput,
  RoomServiceClient,
  SegmentedFileOutput,
  type CreateOptions,
} from "livekit-server-sdk";
import express from "express";
import "dotenv/config";
import cors from "cors";

const LIVEKIT_URL = process.env.LIVEKIT_URL || "ws://localhost:7880";
const LIVEKIT_HTTP = process.env.LIVEKIT_HTTP || "http://localhost:7880";
const API_KEY = process.env.LIVEKIT_API_KEY || "devkey";
const API_SECRET = process.env.LIVEKIT_API_SECRET || "secret";

const roomService = new RoomServiceClient(LIVEKIT_HTTP, API_KEY, API_SECRET);
const egressClient = new EgressClient(LIVEKIT_HTTP, API_KEY, API_SECRET);

// In-memory store (replace with a DB in production)
const exams: Map<string, Exam> = new Map();
const participants: Map<string, Participant[]> = new Map();
const incidents: Map<string, Incident[]> = new Map();

interface Exam {
  id: string;
  title: string;
  duration: number; // minutes
  startTime?: string;
  status: "pending" | "active" | "completed";
  proctorId: string;
  roomName: string;
  e2eeKey: string;
}

interface Participant {
  identity: string;
  name: string;
  examId: string;
  joinedAt: string;
  status: "waiting" | "active" | "flagged" | "removed";
}

interface Incident {
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
interface Proctor {
  identity: string;
  name: string;
  examId: string;
  joinedAt: string;
}
const proctors: Map<string, Proctor[]> = new Map(); // examId → Proctor[]
const tokenCache: Map<string, string> = new Map();

function generateKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/[+/=]/g, "")
    .substring(0, 32);
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

async function generateToken(
  identity: string,
  name: string,
  roomName: string,
  isProctor: boolean,
  examId: string,
): Promise<string> {
  const cacheKey = `${examId}:${identity}`;
  const cached = tokenCache.get(cacheKey);
  if (cached) return cached;

  const at = new AccessToken(API_KEY, API_SECRET, {
    identity,
    name,
    ttl: "4h",
  });

  if (isProctor) {
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: false, // proctors only watch — never publish tracks
      canSubscribe: true,
      canPublishData: true, // allow data-channel messages (chat / flags)
      roomAdmin: true,
    });
  } else {
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true, // camera + mic + screen share
      canSubscribe: false, // students cannot watch other participants
      canPublishData: true,
    });
  }

  const token = await at.toJwt();
  tokenCache.set(cacheKey, token);
  return token;
}

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: "http://localhost:5173", // your frontend URL
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  }),
);

const router = express.Router();

router.get("/", (req, res) => {
  res.json({ message: "ProctorLive API is running" });
});
router.post("/exams", async (req, res) => {
  const body = req.body as {
    title: string;
    duration: number;
    proctorId: string;
    proctorName: string;
  };

  const examId = generateId();
  const roomName = `exam-${examId}`;
  const e2eeKey = generateKey();

  const exam: Exam = {
    id: examId,
    title: body.title,
    duration: body.duration,
    status: "pending",
    proctorId: body.proctorId,
    roomName,
    e2eeKey,
  };

  // Create LiveKit room
  try {
    await roomService.createRoom({
      name: roomName,
      emptyTimeout: 300,
      maxParticipants: 200,
    } as CreateOptions);
  } catch (e) {
    console.error("Room create error (may already exist):", e);
    res.status(500).json({ error: "Failed to create room" });
  }

  exams.set(examId, exam);
  participants.set(examId, []);
  incidents.set(examId, []);

  // Create proctor entry
  const proctorIdentity = `proctor-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const proctor: Proctor = {
    identity: proctorIdentity,
    name: body.proctorName,
    examId,
    joinedAt: new Date().toISOString(),
  };
  const plist = proctors.get(examId) ?? [];
  plist.push(proctor);
  proctors.set(examId, plist);

  // Generate proctor token
  const token = await generateToken(
    proctorIdentity,
    body.proctorName,
    roomName,
    true,
    examId,
  );

  res.status(201).json({ exam, token, livekitUrl: LIVEKIT_URL });
});
router.get("/exams", (req, res) => {
  res.json(Array.from(exams.values()));
});
router.get("/exams/:id", (req, res) => {
  const exam = exams.get(req.params.id);
  if (!exam) return res.status(404).json({ error: "Not found" });
  res.status(200).json(exam);
});
router.put("/exams/:id/start", (req, res) => {
  const exam = exams.get(req.params.id);
  if (!exam) return res.status(404).json({ error: "Not found" });
  exam.status = "active";
  exam.startTime = new Date().toISOString();
  res.status(200).json(exam);
});
router.put("/exams/:id/end", (req, res) => {
  const exam = exams.get(req.params.id);
  if (!exam) return res.status(404).json({ error: "Not found" });
  exam.status = "completed";
  res.status(200).json(exam);
});
router.post("/exams/:id/join", async (req, res) => {
  const exam = exams.get(req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });

  const body = req.body as { name: string; identity: string };
  const existingParticipent = participants
    .get(exam.id)
    ?.find((p) => p.identity === body.identity);
  if (!existingParticipent) {
    const token = await generateToken(
      body.identity,
      body.name,
      exam.roomName,
      false,
      exam.id,
    );
    tokenCache.set(`${exam.id}:${body.identity}`, token);
    const p: Participant = {
      identity: body.identity,
      name: body.name,
      examId: exam.id,
      joinedAt: new Date().toISOString(),
      status: "waiting",
    };

    const list = participants.get(exam.id) ?? [];
    // upsert
    const idx = list.findIndex((x) => x.identity === body.identity);
    if (idx >= 0) list[idx] = p;
    else list.push(p);
    participants.set(exam.id, list);

    res.status(200).json({
      token,
      livekitUrl: LIVEKIT_URL,
      e2eeKey: exam.e2eeKey,
      exam,
    });
  } else {
    let token = tokenCache.get(`${exam.id}:${body.identity}`);
    if (!token) {
      token = await generateToken(
        body.identity,
        body.name,
        exam.roomName,
        false,
        exam.id,
      );
      tokenCache.set(`${exam.id}:${body.identity}`, token);
    }
    res.status(200).json({
      token,
      livekitUrl: LIVEKIT_URL,
      e2eeKey: exam.e2eeKey,
      exam,
    });
  }
});
router.post("/exams/:id/join-proctor", async (req, res) => {
  const exam = exams.get(req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });

  const body = req.body as { name: string; identity: string };
  const existingParticipent = participants
    .get(exam.id)
    ?.find((p) => p.identity === body.identity);
  if (!existingParticipent) {
    const token = await generateToken(
      body.identity,
      body.name,
      exam.roomName,
      true,
      exam.id,
    );
    tokenCache.set(`${exam.id}:${body.identity}`, token);
    const p: Proctor = {
      identity: body.identity,
      name: body.name,
      examId: exam.id,
      joinedAt: new Date().toISOString(),
    };

    const list = proctors.get(exam.id) ?? [];
    // upsert
    const idx = list.findIndex((x) => x.identity === body.identity);
    if (idx >= 0) list[idx] = p;
    else list.push(p);
    proctors.set(exam.id, list);

    res.status(200).json({
      token,
      livekitUrl: LIVEKIT_URL,
      e2eeKey: exam.e2eeKey,
      exam,
    });
  } else {
    let token = tokenCache.get(`${exam.id}:${body.identity}`);
    if (!token) {
      token = await generateToken(
        body.identity,
        body.name,
        exam.roomName,
        true,
        exam.id,
      );
      tokenCache.set(`${exam.id}:${body.identity}`, token);
    }
    res.status(200).json({
      token,
      livekitUrl: LIVEKIT_URL,
      e2eeKey: exam.e2eeKey,
      exam,
    });
  }
});
router.get("/exams/:id/participants", (req, res) => {
  res.json(participants.get(req.params.id) ?? []);
});
router.put("/exams/:id/participants/:identity", (req, res) => {
  const { status } = req.body as {
    status: Participant["status"];
  };
  const list = participants.get(req.params.id) ?? [];
  const p = list.find((x) => x.identity === req.params.identity);
  if (p) p.status = status;
  res.json(p ?? {});
});
// ── GET /api/exams/:id/incidents
router.get("/exams/:id/incidents", (req, res) => {
  const examId = req.params.id;

  return res.json(incidents.get(examId) ?? []);
});
// ── POST /api/exams/:id/incidents
router.post("/exams/:id/incidents", async (req, res) => {
  const examId = req.params.id;

  const body = req.body as Omit<Incident, "id" | "timestamp">;

  const incident: Incident = {
    ...body,

    id: generateId(),

    timestamp: new Date().toISOString(),
  };

  const list = incidents.get(examId) ?? [];

  list.push(incident);

  incidents.set(examId, list);

  // Auto-flag participant on high severity

  if (incident.severity === "high") {
    const plist = participants.get(examId) ?? [];

    const p = plist.find((x) => x.identity === incident.participantIdentity);

    if (p && p.status !== "removed") p.status = "flagged";
  }

  return res.json(incident);
});
// ── POST /api/exams/:id/recording/start
router.post("/exams/:id/recording/start", async (req, res) => {
  const examId = req.params.id;

  const exam = exams.get(examId);

  if (!exam) return res.status(404).json({ error: "Not found" });

  try {
    const egress = await egressClient.startRoomCompositeEgress(exam.roomName, {
      segments: new SegmentedFileOutput({
        filenamePrefix: exam.roomName,
        playlistName: exam.roomName + ".m3u8",
        livePlaylistName: exam.roomName + "-live.m3u8",
        segmentDuration: 2,
        output: {
          case: "s3",
          value: {
            accessKey: process.env.AWS_ACCESS_KEY,
            secret: process.env.AWS_SECRET,
            bucket: process.env.AWS_BUCKET,
            region: process.env.AWS_REGION,
          },
        },
      }),
    });

    return res.json({ egressId: egress.egressId, status: "recording" });
  } catch (err) {
    console.error("Recording error:", err);

    return res.status(500).json({ error: String(err) });
  }
});
// ── POST /api/exams/:id/recording/stop
router.post("/exams/:id/recording/stop", async (req, res) => {
  const examId = req.params.id;

  const exam = exams.get(examId);

  if (!exam) return res.status(404).json({ error: "Not found" });

  const { egressId } = req.body as { egressId: string };

  try {
    await egressClient.stopEgress(egressId);

    return res.json({ status: "stopped" });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});
// ── POST /api/exams/:id/kick/:identity
router.post("/exams/:id/kick/:identity", async (req, res) => {
  const examId = req.params.id;

  const identity = decodeURIComponent(req.params.identity);

  const exam = exams.get(examId);

  if (!exam) return res.status(404).json({ error: "Not found" });

  try {
    await roomService.removeParticipant(exam.roomName, identity);

    const plist = participants.get(examId) ?? [];

    const p = plist.find((x) => x.identity === identity);

    if (p) p.status = "removed";

    return res.json({ status: "kicked" });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});
// ── POST /api/exams/:id/mute/:identity
router.post("/exams/:id/mute/:identity", async (req, res) => {
  const examId = req.params.id;

  const identity = decodeURIComponent(req.params.identity);

  const exam = exams.get(examId);

  if (!exam) return res.status(404).json({ error: "Not found" });

  const { trackSid, muted } = req.body as {
    trackSid: string;

    muted: boolean;
  };

  try {
    await roomService.mutePublishedTrack(
      exam.roomName,

      identity,

      trackSid,

      muted,
    );

    return res.json({ status: "ok" });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.use("/api", router);
app.listen(3001, () => {
  console.log(`
╔══════════════════════════════════════╗
║   ProctorLive API Server             ║
║   Running on http://localhost:3000   ║
║   LiveKit: ${LIVEKIT_HTTP}     ║
╚══════════════════════════════════════╝
`);
});

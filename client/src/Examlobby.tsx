import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, Mic, ShieldCheck, Clock, AlertCircle } from "lucide-react";
import { useAppStore } from "./store";

export function ExamLobby() {
  const navigate = useNavigate();
  const exam = useAppStore((s) => s.exam);
  const displayName = useAppStore((s) => s.displayName);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camOk, setCamOk] = useState<boolean | null>(null);
  const [micOk, setMicOk] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!exam) navigate("/");
  }, [exam, navigate]);

  const runChecks = async () => {
    setChecking(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.play();
      }
      setCamOk(true);
      setMicOk(true);
      setReady(true);
    } catch {
      setCamOk(false);
      setMicOk(false);
    } finally {
      setChecking(false);
    }
  };

  const handleEnter = () => {
    stream?.getTracks().forEach((t) => t.stop());
    navigate("/exam");
  };

  if (!exam) return null;

  return (
    <div className="lobby-page">
      <div className="lobby-bg" />

      <div className="lobby-container animate-in">
        <div className="lobby-header">
          <ShieldCheck size={20} className="accent-icon" />
          <span>ProctorLive</span>
        </div>

        <div className="lobby-card">
          <div className="lobby-exam-info">
            <div className="lobby-eyebrow">You are about to enter</div>
            <h1 className="lobby-title">{exam.title}</h1>
            <div className="lobby-meta">
              <span className="badge badge-blue">
                <Clock size={10} />
                {exam.duration} min
              </span>
              <span className="badge badge-gray">
                ID: {exam.id.split("-")[0]}
              </span>
              <span className="badge badge-green">
                <ShieldCheck size={10} />
                E2EE Active
              </span>
            </div>
          </div>

          <div className="lobby-cols">
            {/* Camera preview */}
            <div className="cam-preview-wrap">
              <video ref={videoRef} muted className="cam-preview" />
              {!stream && (
                <div className="cam-placeholder">
                  <Camera size={32} color="var(--text-3)" />
                  <span>Camera Preview</span>
                </div>
              )}
            </div>

            {/* Checks */}
            <div className="checks-panel">
              <div className="checks-title">System Check</div>

              <CheckRow
                label="Webcam"
                icon={<Camera size={14} />}
                status={camOk}
              />
              <CheckRow
                label="Microphone"
                icon={<Mic size={14} />}
                status={micOk}
              />
              <CheckRow
                label="Identity"
                icon={<ShieldCheck size={14} />}
                status={true}
                note={displayName}
              />

              {!ready && (
                <button
                  className="btn btn-primary"
                  style={{ width: "100%", marginTop: 20 }}
                  onClick={runChecks}
                  disabled={checking}
                >
                  <Camera size={15} />
                  {checking ? "Checking..." : "Test Camera & Mic"}
                </button>
              )}

              {ready && (
                <>
                  <div className="ready-notice">
                    <ShieldCheck size={14} />
                    All systems ready. Your session will be encrypted.
                  </div>
                  <div className="rules-box">
                    <div className="rules-title">
                      <AlertCircle size={13} /> Exam Rules
                    </div>
                    <ul className="rules-list">
                      <li>Do not switch browser tabs</li>
                      <li>Keep your face visible at all times</li>
                      <li>No mobile phones or secondary devices</li>
                      <li>Your session is being recorded</li>
                    </ul>
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ width: "100%", marginTop: 16 }}
                    onClick={handleEnter}
                  >
                    Enter Exam Room →
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .lobby-page {
          min-height: 100vh; display: flex; align-items: center; justify-content: center;
          padding: 24px; position: relative;
        }
        .lobby-bg {
          position: fixed; inset: 0; pointer-events: none;
          background: radial-gradient(ellipse 70% 60% at 50% 30%, rgba(59,130,246,0.05) 0%, transparent 70%);
        }
        .lobby-container { width: 100%; max-width: 760px; position: relative; z-index: 1; }
        .lobby-header {
          display: flex; align-items: center; gap: 8px;
          font-family: var(--font-display); font-size: 15px; font-weight: 700;
          margin-bottom: 24px;
        }
        .accent-icon { color: var(--accent); }
        .lobby-card {
          background: var(--surface); border: 1px solid var(--border-2);
          border-radius: var(--radius-lg); padding: 32px;
        }
        .lobby-exam-info { margin-bottom: 28px; }
        .lobby-eyebrow {
          font-family: var(--font-mono); font-size: 11px; color: var(--accent);
          text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px;
        }
        .lobby-title {
          font-family: var(--font-display); font-size: 28px; font-weight: 800;
          margin-bottom: 12px;
        }
        .lobby-meta { display: flex; gap: 8px; flex-wrap: wrap; }
        .lobby-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        @media (max-width: 580px) { .lobby-cols { grid-template-columns: 1fr; } }

        .cam-preview-wrap {
          aspect-ratio: 4/3; background: var(--bg-3); border-radius: var(--radius);
          overflow: hidden; position: relative; border: 1px solid var(--border);
        }
        .cam-preview { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
        .cam-placeholder {
          position: absolute; inset: 0; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 10px; color: var(--text-3);
          font-size: 12px;
        }

        .checks-panel { display: flex; flex-direction: column; gap: 0; }
        .checks-title {
          font-family: var(--font-mono); font-size: 11px; text-transform: uppercase;
          letter-spacing: 0.08em; color: var(--text-2); margin-bottom: 12px;
        }
        .check-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 0; border-bottom: 1px solid var(--border);
        }
        .check-row:last-of-type { border-bottom: none; }
        .check-label { display: flex; align-items: center; gap: 8px; color: var(--text-2); font-size: 13px; }
        .check-status { font-size: 11px; font-weight: 600; font-family: var(--font-mono); }

        .ready-notice {
          display: flex; align-items: center; gap: 8px;
          background: var(--green-bg); border: 1px solid rgba(34,197,94,0.2);
          color: var(--green); border-radius: var(--radius); padding: 10px 12px;
          font-size: 12px; margin-top: 16px;
        }
        .rules-box {
          background: var(--bg-3); border: 1px solid var(--border);
          border-radius: var(--radius); padding: 14px; margin-top: 12px;
        }
        .rules-title {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; font-weight: 600; color: var(--yellow); margin-bottom: 8px;
        }
        .rules-list {
          list-style: none; display: flex; flex-direction: column; gap: 5px;
        }
        .rules-list li {
          color: var(--text-2); font-size: 12px; padding-left: 14px; position: relative;
        }
        .rules-list li::before {
          content: "–"; position: absolute; left: 0; color: var(--text-3);
        }
      `}</style>
    </div>
  );
}

function CheckRow({
  label,
  icon,
  status,
  note,
}: {
  label: string;
  icon: React.ReactNode;
  status: boolean | null;
  note?: string;
}) {
  return (
    <div className="check-row">
      <div className="check-label">
        {icon}
        {label}
        {note && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-3)",
            }}
          >
            ({note})
          </span>
        )}
      </div>
      <span
        className="check-status"
        style={{
          color:
            status === null
              ? "var(--text-3)"
              : status
                ? "var(--green)"
                : "var(--red)",
        }}
      >
        {status === null ? "PENDING" : status ? "✓ OK" : "✗ FAIL"}
      </span>
    </div>
  );
}

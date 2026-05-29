import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheck,
  GraduationCap,
  Lock,
  Video,
  AlertTriangle,
} from "lucide-react";
import { api } from "./Api";
import { useAppStore } from "./store";

export function LandingPage() {
  const navigate = useNavigate();
  const setSession = useAppStore((s) => s.setSession);
  const setExamSession = useAppStore((s) => s.setExamSession);

  const [mode, setMode] = useState<"home" | "create" | "proctor" | "student">(
    "home",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Proctor form
  const [examTitle, setExamTitle] = useState("");
  const [duration, setDuration] = useState("60");
  const [proctorName, setProctorName] = useState("");

  // Student form
  const [studentName, setStudentName] = useState("");
  const [examId, setExamId] = useState("");

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!examTitle || !proctorName) return;
    setLoading(true);
    setError("");
    try {
      const proctorId = `proctor-${Date.now()}`;
      const res = await api.createExam({
        title: examTitle,
        duration: parseInt(duration),
        proctorId,
        proctorName,
      });
      setSession("proctor", proctorId, proctorName);
      setExamSession(res.exam, res.token, res.livekitUrl, res.exam.e2eeKey);
      navigate("/proctor");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleJoinExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName || !examId) return;
    setLoading(true);
    setError("");
    try {
      const identity = `student-${Date.now()}`;
      const res = await api.joinExam(examId.trim(), {
        name: studentName,
        identity,
      });
      setSession("student", identity, studentName);
      setExamSession(res.exam, res.token, res.livekitUrl, res.e2eeKey);
      navigate("/exam");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };
  const handleJoinProctor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proctorName || !examId) return;
    setLoading(true);
    setError("");
    try {
      const identity = `proctor-${Date.now()}`;
      const res = await api.joinProctor(examId.trim(), {
        name: proctorName,
        identity,
      });
      setSession("proctor", identity, proctorName);
      setExamSession(res.exam, res.token, res.livekitUrl, res.e2eeKey);
      navigate("/proctor");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="landing">
      <div className="landing-bg" />

      <header className="landing-header">
        <div className="logo">
          <ShieldCheck size={22} strokeWidth={2.5} />
          <span>ProctorLive</span>
        </div>
        <div className="header-badges">
          <span className="badge badge-green">
            <Lock size={10} />
            E2EE
          </span>
          <span className="badge badge-blue">
            <Video size={10} />
            Recording
          </span>
          <span className="badge badge-purple">
            <AlertTriangle size={10} />
            AI Proctoring
          </span>
        </div>
      </header>

      <main className="landing-main">
        {mode === "home" && (
          <div className="hero animate-in">
            <div className="hero-eyebrow">Secure Online Examination</div>
            <h1 className="hero-title">
              Proctor exams with
              <br />
              <span className="gradient-text">end-to-end encryption</span>
            </h1>
            <p className="hero-sub">
              Real-time video proctoring powered by LiveKit with E2EE, incident
              detection, recording, and a full dashboard.
            </p>
            <div className="hero-actions">
              <button
                className="btn btn-primary btn-lg"
                onClick={() => setMode("create")}
              >
                <ShieldCheck size={18} />
                Create Exam (Proctor)
              </button>
              <button
                className="btn btn-primary btn-lg"
                onClick={() => setMode("proctor")}
              >
                <ShieldCheck size={18} />
                Join Exam (Proctor)
              </button>
              <button
                className="btn btn-ghost btn-lg"
                onClick={() => setMode("student")}
              >
                <GraduationCap size={18} />
                Join Exam (Student)
              </button>
            </div>
            <div className="feature-grid">
              {FEATURES.map((f) => (
                <div key={f.title} className="feature-card">
                  <div className="feature-icon">{f.icon}</div>
                  <div>
                    <div className="feature-title">{f.title}</div>
                    <div className="feature-desc">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === "create" && (
          <div className="form-panel animate-in">
            <button
              className="back-btn"
              onClick={() => {
                setMode("home");
                setError("");
              }}
            >
              ← Back
            </button>
            <div className="form-header">
              <ShieldCheck size={28} className="form-icon-blue" />
              <h2>Create New Exam</h2>
              <p>Set up a proctored session with E2EE</p>
            </div>
            <form onSubmit={handleCreateExam}>
              <div className="field">
                <label className="label">Exam Title</label>
                <input
                  className="input"
                  placeholder="e.g. Calculus Final Exam"
                  value={examTitle}
                  onChange={(e) => setExamTitle(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label className="label">Your Name</label>
                <input
                  className="input"
                  placeholder="Prof. Jane Smith"
                  value={proctorName}
                  onChange={(e) => setProctorName(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label className="label">Duration (minutes)</label>
                <input
                  className="input"
                  type="number"
                  min="5"
                  max="360"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  required
                />
              </div>
              {error && <div className="error-box">{error}</div>}
              <button
                className="btn btn-primary"
                style={{ width: "100%" }}
                type="submit"
                disabled={loading}
              >
                {loading ? "Creating..." : "Create Exam & Enter Dashboard"}
              </button>
            </form>
          </div>
        )}

        {mode === "student" && (
          <div className="form-panel animate-in">
            <button
              className="back-btn"
              onClick={() => {
                setMode("home");
                setError("");
              }}
            >
              ← Back
            </button>
            <div className="form-header">
              <GraduationCap size={28} className="form-icon-blue" />
              <h2>Join Exam</h2>
              <p>Enter the exam ID provided by your proctor</p>
            </div>
            <form onSubmit={handleJoinExam}>
              <div className="field">
                <label className="label">Your Name</label>
                <input
                  className="input"
                  placeholder="John Doe"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label className="label">Exam ID</label>
                <input
                  className="input"
                  placeholder="e.g. 1234567890-abc1234"
                  value={examId}
                  onChange={(e) => setExamId(e.target.value)}
                  required
                  style={{ fontFamily: "var(--font-mono)" }}
                />
              </div>
              {error && <div className="error-box">{error}</div>}
              <button
                className="btn btn-primary"
                style={{ width: "100%" }}
                type="submit"
                disabled={loading}
              >
                {loading ? "Joining..." : "Join Exam"}
              </button>
            </form>
          </div>
        )}
        {mode === "proctor" && (
          <div className="form-panel animate-in">
            <button
              className="back-btn"
              onClick={() => {
                setMode("home");
                setError("");
              }}
            >
              ← Back
            </button>
            <div className="form-header">
              <GraduationCap size={28} className="form-icon-blue" />
              <h2>Join Exam (Proctor)</h2>
              <p>Enter the exam ID</p>
            </div>
            <form onSubmit={handleJoinProctor}>
              <div className="field">
                <label className="label">Your Name</label>
                <input
                  className="input"
                  placeholder="John Doe"
                  value={proctorName}
                  onChange={(e) => setProctorName(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label className="label">Exam ID</label>
                <input
                  className="input"
                  placeholder="e.g. 1234567890-abc1234"
                  value={examId}
                  onChange={(e) => setExamId(e.target.value)}
                  required
                  style={{ fontFamily: "var(--font-mono)" }}
                />
              </div>
              {error && <div className="error-box">{error}</div>}
              <button
                className="btn btn-primary"
                style={{ width: "100%" }}
                type="submit"
                disabled={loading}
              >
                {loading ? "Joining..." : "Join Exam"}
              </button>
            </form>
          </div>
        )}
      </main>

      <style>{`
        .landing {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          position: relative;
        }
        .landing-bg {
          position: fixed; inset: 0; pointer-events: none;
          background:
            radial-gradient(ellipse 60% 50% at 20% 20%, rgba(59,130,246,0.06) 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at 80% 80%, rgba(168,85,247,0.05) 0%, transparent 60%);
        }
        .landing-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 20px 40px;
          border-bottom: 1px solid var(--border);
          position: relative; z-index: 1;
        }
        .logo {
          display: flex; align-items: center; gap: 10px;
          font-family: var(--font-display); font-size: 18px; font-weight: 700;
          color: var(--text);
        }
        .logo svg { color: var(--accent); }
        .header-badges { display: flex; gap: 8px; }
        .landing-main {
          flex: 1; display: flex; align-items: center; justify-content: center;
          padding: 60px 20px; position: relative; z-index: 1;
        }
        .hero { max-width: 640px; text-align: center; }
        .hero-eyebrow {
          font-family: var(--font-mono); font-size: 11px; font-weight: 600;
          color: var(--accent); text-transform: uppercase; letter-spacing: 0.1em;
          margin-bottom: 16px;
        }
        .hero-title {
          font-family: var(--font-display); font-size: 52px; font-weight: 800;
          line-height: 1.1; margin-bottom: 16px; color: var(--text);
        }
        .gradient-text {
          background: linear-gradient(135deg, var(--accent) 0%, var(--purple) 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        .hero-sub {
          color: var(--text-2); font-size: 16px; margin-bottom: 36px; line-height: 1.7;
        }
        .hero-actions { display: flex; gap: 12px; justify-content: center; margin-bottom: 52px; flex-wrap: wrap; }
        .feature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; text-align: left; }
        .feature-card {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius); padding: 16px; display: flex; gap: 12px; align-items: flex-start;
        }
        .feature-icon { color: var(--accent); margin-top: 2px; flex-shrink: 0; }
        .feature-title { font-weight: 600; font-size: 13px; margin-bottom: 3px; }
        .feature-desc { color: var(--text-2); font-size: 12px; line-height: 1.5; }

        .form-panel {
          width: 100%; max-width: 420px;
          background: var(--surface); border: 1px solid var(--border-2);
          border-radius: var(--radius-lg); padding: 32px;
        }
        .back-btn {
          background: none; border: none; color: var(--text-2); cursor: pointer;
          font-size: 13px; margin-bottom: 24px; padding: 0;
          font-family: var(--font-body); transition: color 0.15s;
        }
        .back-btn:hover { color: var(--text); }
        .form-header { text-align: center; margin-bottom: 28px; }
        .form-header h2 { font-family: var(--font-display); font-size: 22px; font-weight: 700; margin: 10px 0 6px; }
        .form-header p { color: var(--text-2); font-size: 13px; }
        .form-icon-blue { color: var(--accent); }

        .error-box {
          background: var(--red-bg); border: 1px solid rgba(239,68,68,0.25);
          border-radius: var(--radius); padding: 10px 14px;
          color: var(--red); font-size: 12px; margin-bottom: 16px;
          font-family: var(--font-mono);
        }
      `}</style>
    </div>
  );
}

const FEATURES = [
  {
    icon: <Lock size={16} />,
    title: "End-to-End Encrypted",
    desc: "All video/audio streams are E2EE — unreadable to servers",
  },
  {
    icon: <Video size={16} />,
    title: "Session Recording",
    desc: "Full room composite recording with LiveKit Egress",
  },
  {
    icon: <AlertTriangle size={16} />,
    title: "Incident Detection",
    desc: "Tab switch, no-face, multiple-face flagging",
  },
  {
    icon: <ShieldCheck size={16} />,
    title: "Proctor Dashboard",
    desc: "Watch all participants, flag, mute or remove in real-time",
  },
];

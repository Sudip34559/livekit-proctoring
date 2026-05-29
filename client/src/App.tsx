import { Route, Routes } from "react-router-dom";
import { ExamLobby } from "./Examlobby";
import { ProctoredExam } from "./Proctoredexam";
import { ProctorDashboard } from "./Proctordashboard";
import { LandingPage } from "./Landingpage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/lobby" element={<ExamLobby />} />
      <Route path="/exam" element={<ProctoredExam />} />
      <Route path="/proctor" element={<ProctorDashboard />} />
    </Routes>
  );
}

export default App;

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import SessionListPage from "./pages/SessionListPage";
import SessionPage from "./pages/SessionPage";

export default function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SessionListPage />} />
        <Route path="/sessions/:id" element={<SessionPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

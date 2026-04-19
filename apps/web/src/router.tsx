import { BrowserRouter, Routes, Route } from "react-router-dom";
import SessionListPage from "./pages/SessionListPage";
import SessionPage from "./pages/SessionPage";

export default function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SessionListPage />} />
        <Route path="/sessions/:id" element={<SessionPage />} />
      </Routes>
    </BrowserRouter>
  );
}

import { BrowserRouter, Routes, Route } from "react-router-dom";
import SessionListPage from "./pages/SessionListPage.js";
import SessionPage from "./pages/SessionPage.js";

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

import { useEffect, useState } from "react";
import "./globals.css";

type HealthResult =
  | { status: "loading" }
  | { status: "ok"; data: { ok: boolean } }
  | { status: "error"; message: string };

export default function App() {
  const [health, setHealth] = useState<HealthResult>({ status: "loading" });

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((body: unknown) => {
        if (
          body !== null &&
          typeof body === "object" &&
          "ok" in body &&
          typeof (body as { ok: unknown }).ok === "boolean"
        ) {
          setHealth({ status: "ok", data: { ok: (body as { ok: boolean }).ok } });
        } else {
          setHealth({ status: "error", message: "unexpected health shape" });
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "unknown error";
        setHealth({ status: "error", message });
      });
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <h1 className="text-2xl font-semibold text-gray-800 mb-4">
          prd-assist
        </h1>
        {health.status === "loading" && (
          <p className="text-gray-500">checking health…</p>
        )}
        {health.status === "ok" && (
          <p className="text-green-600 font-mono">
            ok: {String(health.data.ok)}
          </p>
        )}
        {health.status === "error" && (
          <p className="text-red-600 font-mono">{health.message}</p>
        )}
      </div>
    </div>
  );
}

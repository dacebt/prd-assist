import { startServer } from "./server.js";

function main(): void {
  const sqlitePath = process.env["SQLITE_PATH"] ?? "./data/prd-assist.sqlite";
  startServer({ sqlitePath, hostname: "127.0.0.1", port: 5174 });
}

main();

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunSummary, TraceEvent } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export interface ServeOptions {
  dir?: string;
  port?: number;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

function serveStatic(publicDir: string, req: IncomingMessage, res: ServerResponse): boolean {
  const urlPath = (req.url ?? "/").split("?")[0];
  const relPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = join(publicDir, relPath);
  if (!filePath.startsWith(publicDir)) return false;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
  const ext = extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  res.end(readFileSync(filePath));
  return true;
}

export function startServer(options: ServeOptions = {}): { url: string; close: () => void } {
  const dir = options.dir ?? ".stepglass";
  const port = options.port ?? 4550;
  const publicDir = join(__dirname, "..", "dashboard", "public");

  const server = createServer((req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0];

    if (urlPath === "/api/runs") {
      const indexPath = join(dir, "index.json");
      if (!existsSync(indexPath)) return sendJson(res, 200, []);
      try {
        const index: Record<string, RunSummary> = JSON.parse(readFileSync(indexPath, "utf-8"));
        const runs = Object.values(index).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
        return sendJson(res, 200, runs);
      } catch (err) {
        return sendJson(res, 500, { error: "failed to read index", detail: String(err) });
      }
    }

    if (urlPath.startsWith("/api/runs/")) {
      const runId = decodeURIComponent(urlPath.slice("/api/runs/".length));
      const filePath = join(dir, "traces", `${runId}.jsonl`);
      if (!existsSync(filePath)) return sendJson(res, 404, { error: "run not found" });
      const lines = readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
      const events: TraceEvent[] = lines.map((line) => JSON.parse(line));
      return sendJson(res, 200, events);
    }

    if (urlPath === "/api/discover") {
      try {
        const candidates = readdirSync(".", { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .filter((name) => existsSync(join(name, ".stepglass", "index.json")));
        return sendJson(res, 200, candidates);
      } catch {
        return sendJson(res, 200, []);
      }
    }

    if (serveStatic(publicDir, req, res)) return;

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  server.listen(port);
  return {
    url: `http://localhost:${port}`,
    close: () => server.close(),
  };
}

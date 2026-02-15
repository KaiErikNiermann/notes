import connect from "connect";
import fs from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";
import chokidar from "chokidar";
import serveStatic from "serve-static";
import { WebSocket, WebSocketServer } from "ws";

const PORT = 1313;
const WS_PORT = 35729;
const WS_HOST = "127.0.0.1";
const ROOT = path.join(__dirname, "output");

const LIVE_RELOAD_SCRIPT = `<script>
(function() {
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    var ws = new WebSocket("ws://${WS_HOST}:${WS_PORT}");
    ws.onmessage = function(e) {
      if (e.data === "reload") {
        location.reload();
      }
    };
    ws.onclose = function() {
      setTimeout(function() { location.reload(); }, 2000);
    };
  }
})();
</script>`;

const app = connect();
const wss = new WebSocketServer({ port: WS_PORT });

console.log(`Live reload WebSocket server on port ${WS_PORT}`);

const broadcastReload = (filePath: string): void => {
  console.log(`File changed: ${filePath}`);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send("reload");
    }
  }
};

const watcher = chokidar.watch(ROOT, {
  ignored: /(^|[/\\])\../,
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 300,
    pollInterval: 100,
  },
});

watcher.on("change", broadcastReload);
watcher.on("add", broadcastReload);

const getPathAndQuery = (requestUrl: string): { pathOnly: string; query: string } => {
  const [pathOnly, ...queryParts] = requestUrl.split("?");
  const query = queryParts.length > 0 ? `?${queryParts.join("?")}` : "";
  return { pathOnly: pathOnly || "/", query };
};

const toSafeRelativePath = (urlPath: string): string | null => {
  const withoutLeadingSlash = urlPath.replace(/^\/+/, "");
  const normalized = path.posix.normalize(withoutLeadingSlash);

  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return null;
  }

  return normalized;
};

const injectLiveReloadScript = (html: string): string => {
  if (html.includes("</body>")) {
    return html.replace("</body>", `${LIVE_RELOAD_SCRIPT}</body>`);
  }

  if (html.includes("</head>")) {
    return html.replace("</head>", `${LIVE_RELOAD_SCRIPT}</head>`);
  }

  return `${html}${LIVE_RELOAD_SCRIPT}`;
};

app.use((req, _res, next) => {
  const requestUrl = req.url ?? "/";
  const { pathOnly, query } = getPathAndQuery(requestUrl);

  if (!pathOnly.endsWith("/")) {
    next();
    return;
  }

  const safeDirectory = toSafeRelativePath(pathOnly);
  if (safeDirectory === null) {
    next();
    return;
  }

  const indexHtml = path.join(ROOT, safeDirectory, "index.html");
  const indexXml = path.join(ROOT, safeDirectory, "index.xml");

  if (fs.existsSync(indexHtml)) {
    req.url = `${pathOnly}index.html${query}`;
  } else if (fs.existsSync(indexXml)) {
    req.url = `${pathOnly}index.xml${query}`;
  }

  next();
});

app.use((req, res: ServerResponse, next) => {
  const requestUrl = req.url ?? "/";
  const { pathOnly } = getPathAndQuery(requestUrl);

  if (!pathOnly.endsWith(".html")) {
    next();
    return;
  }

  const safePath = toSafeRelativePath(pathOnly);
  if (safePath === null) {
    res.statusCode = 400;
    res.end("Bad request");
    return;
  }

  const filePath = path.join(ROOT, safePath);
  if (!fs.existsSync(filePath)) {
    next();
    return;
  }

  const html = fs.readFileSync(filePath, "utf8");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(injectLiveReloadScript(html));
});

app.use(serveStatic(ROOT));

app.listen(PORT, () => {
  console.log(`Server running at http://${WS_HOST}:${PORT}/`);
  console.log(`Serving files from: ${ROOT}`);
  console.log("Live reload enabled - watching for changes...");
});

const shutdown = (): void => {
  void watcher.close();
  wss.close();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import connect from "connect";
import * as esbuild from "esbuild";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";
import chokidar from "chokidar";
import serveStatic from "serve-static";
import { WebSocket, WebSocketServer } from "ws";

const PORT = 1313;
const WS_PORT = 35_729;
const BIND_HOST = process.env.BIND_HOST ?? "127.0.0.1";
const WS_HOST = "127.0.0.1";
const ROOT = path.join(__dirname, "output");
const TREES_ROOT = path.join(__dirname, "trees");
const ASSETS_ROOT = path.join(__dirname, "assets");
const PROJECT_ROOT = __dirname;

// The build normalises forester's output to output/notes/, but forester bakes
// (path-only) links from the last path segment of forest.toml's `url` — e.g. a
// forest published at https://you.github.io/my-forest/ links to /my-forest/…, at
// /notes/ links to /notes/…. `SITE` is that public base segment (default
// "notes"); the server maps the public /SITE/ base onto the internal output/notes/
// so `just serve` works for a forest at any URL. A pathless url (e.g.
// http://localhost/) has no segment and can't be served cleanly — warn and fall
// back to /notes/.
const siteSegmentFromForestToml = (): string => {
  try {
    const toml = fs.readFileSync(path.join(__dirname, "forest.toml"), "utf8");
    const match = /^\s*url\s*=\s*["']([^"']*)["']/m.exec(toml);
    if (!match?.[1]) return "";
    return /([^/]+)\/*$/.exec(new URL(match[1]).pathname)?.[1] ?? "";
  } catch {
    return "";
  }
};
const RAW_SITE_SEGMENT = siteSegmentFromForestToml();
const SITE = RAW_SITE_SEGMENT || "notes";

// Set true in Docker (no build tools available, just serve + reload on output changes)
const SERVE_ONLY = process.env.SERVE_ONLY === "1";

// ---------------------------------------------------------------------------
// Build orchestration
// ---------------------------------------------------------------------------

type BuildStatus = "idle" | "building";
let buildStatus: BuildStatus = "idle";
let lastBuildEpoch: number | null = null;
let buildInFlight = false;
let buildQueued = false;
let outputDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const formatTimestamp = (): string =>
  new Date().toLocaleTimeString("en-GB", { hour12: false });

const broadcast = (data: string): void => {
  console.log(`[ws] broadcasting to ${wss.clients.size} clients: ${data}`);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
};

const broadcastBuildStart = (): void => {
  buildStatus = "building";
  console.log("[build] started");
  broadcast(JSON.stringify({ type: "build_start" }));
};

const broadcastBuildDone = (): void => {
  buildStatus = "idle";
  lastBuildEpoch = Date.now();
  console.log(`[build] done at ${formatTimestamp()}`);
  broadcast(JSON.stringify({ type: "build_done", epoch: lastBuildEpoch }));
  broadcast(JSON.stringify({ type: "reload" }));
};

// Each build runs in a FRESH subprocess (tsx scripts/build.ts) rather than
// in-process. The on-disk cache still makes it incremental, but a new process
// always loads the current renderer/stage code — so editing build/renderer
// source can never leave this long-running server rendering with a stale
// in-memory module (which would poison the content-hash cache).
const TSX_BIN = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsx");

const runBuild = (): void => {
  if (buildInFlight) {
    buildQueued = true;
    return;
  }
  buildInFlight = true;
  broadcastBuildStart();

  let finished = false;
  const finish = (): void => {
    if (finished) return; // "error" and "exit" can both fire — run once
    finished = true;
    buildInFlight = false;
    broadcastBuildDone();
    if (buildQueued) {
      buildQueued = false;
      runBuild();
    }
  };

  const child = spawn(TSX_BIN, ["scripts/build.ts"], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "inherit", "inherit"], // stream the build's own logs to our console
  });
  child.on("error", (err) => {
    console.error(`[build] failed to spawn: ${err.message}`);
    finish();
  });
  child.on("exit", (code) => {
    if (code !== 0) console.error(`[build] subprocess exited with code ${code}`);
    finish();
  });
};

// ---------------------------------------------------------------------------
// Client-side dev script
// ---------------------------------------------------------------------------

// String.raw is REQUIRED here: the emitted browser script contains `<\/script>` and
// regex literals like /\/notes\//, whose backslashes must survive verbatim.
const DEV_SCRIPT = String.raw`<script>
(function() {
  if (!(location.hostname === "localhost" || location.hostname === "127.0.0.1")) return;

  var STORAGE_KEY = "forester_build_status";
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch(_) {}

  var el = document.createElement("div");
  el.id = "build-indicator";
  el.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:99999;padding:6px 12px;"
    + "border-radius:6px;font:12px/1.4 system-ui,sans-serif;pointer-events:none;"
    + "transition:opacity .3s,background .3s;display:flex;align-items:center;gap:6px;"
    + "backdrop-filter:blur(4px);";

  var dot = document.createElement("span");
  dot.style.cssText = "width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0;";
  var label = document.createElement("span");

  el.appendChild(dot);
  el.appendChild(label);
  document.body.appendChild(el);

  var style = document.createElement("style");
  style.textContent = "@keyframes build-pulse{0%,100%{opacity:.4}50%{opacity:1}}";
  document.head.appendChild(style);

  var buildTime = null;
  var tickTimer = null;

  function fmtElapsed(ms) {
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60); s = s % 60;
    if (m < 60) return m + "m " + (s < 10 ? "0" : "") + s + "s";
    var h = Math.floor(m / 60); m = m % 60;
    return h + "h " + (m < 10 ? "0" : "") + m + "m";
  }

  function renderBuilt() {
    if (!buildTime) return;
    var ago = fmtElapsed(Date.now() - buildTime);
    label.innerHTML = "<span style='color:rgba(255,255,255,0.7)'>" + ago + " ago</span>"
      + " <span style='color:#16a34a'>Built</span>";
  }

  function showBuilding() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    el.style.background = "rgba(0,0,0,0.25)";
    el.style.border = "1px solid rgba(202,138,4,0.35)";
    dot.style.background = "#ca8a04";
    dot.style.animation = "build-pulse 1s ease-in-out infinite";
    label.innerHTML = "<span style='color:#ca8a04'>Building\u2026</span>";
  }

  function showBuilt(epoch) {
    buildTime = epoch;
    el.style.background = "rgba(0,0,0,0.2)";
    el.style.border = "1px solid rgba(22,163,74,0.3)";
    dot.style.background = "#16a34a";
    dot.style.animation = "none";
    renderBuilt();
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(renderBuilt, 1000);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ epoch: epoch })); } catch(_) {}
  }

  if (saved && saved.epoch) showBuilt(saved.epoch);
  else {
    el.style.background = "rgba(0,0,0,0.2)";
    el.style.border = "1px solid rgba(22,163,74,0.3)";
    dot.style.background = "#16a34a";
    dot.style.animation = "none";
    label.innerHTML = "<span style='color:rgba(255,255,255,0.7)'>--</span>"
      + " <span style='color:#16a34a'>Built</span>";
  }

  var wsUrl = "ws://${WS_HOST}:${WS_PORT}";

  function wsConnect() {
    var ws = new WebSocket(wsUrl);
    ws.onmessage = function(e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === "build_start") { showBuilding(); return; }
        if (msg.type === "build_done") { showBuilt(msg.epoch); return; }
        if (msg.type === "reload") { location.reload(); return; }
      } catch(_) {}
    };
    ws.onclose = function() { setTimeout(wsConnect, 2000); };
  }
  wsConnect();

  // --- artifact paste (Phase 3): CTRL+V an image → confirm → inject or copy ---
  function showToast(msg, ok) {
    var t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = "position:fixed;bottom:48px;right:12px;z-index:99999;max-width:42ch;"
      + "padding:8px 12px;border-radius:6px;font:12px/1.45 system-ui,sans-serif;"
      + "color:#fff;background:" + (ok === false ? "rgba(153,27,27,0.92)" : "rgba(22,101,52,0.92)")
      + ";box-shadow:0 6px 20px rgba(0,0,0,0.35);backdrop-filter:blur(4px);"
      + "transition:opacity .3s;opacity:0;";
    document.body.appendChild(t);
    requestAnimationFrame(function() { t.style.opacity = "1"; });
    setTimeout(function() { t.style.opacity = "0"; setTimeout(function() { t.remove(); }, 350); }, 4200);
  }

  var MIME_EXT = { "image/png":"png","image/jpeg":"jpg","image/gif":"gif","image/webp":"webp","image/svg+xml":"svg","image/avif":"avif" };
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function closeAttachDialog() { var ex = document.getElementById("artifact-attach-dialog"); if (ex) ex.remove(); }

  function postAttach(file, tree, name, inject) {
    var qs = "tree=" + encodeURIComponent(tree) + "&name=" + encodeURIComponent(name) + "&inject=" + (inject ? "1" : "0");
    return fetch("/__dev/attach?" + qs, { method: "POST", headers: { "Content-Type": file.type }, body: file })
      .then(function(r) { if (!r.ok) return r.text().then(function(t) { throw new Error(t || ("HTTP " + r.status)); }); return r.json(); });
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
    return Promise.resolve();
  }
  function embedSnippet(j) { return "\embed{image}{#artifact:" + j.key + "}{}"; }

  function showAttachDialog(file, tree, ext, defaultName) {
    closeAttachDialog();
    var card = document.createElement("div");
    card.id = "artifact-attach-dialog";
    card.style.cssText = "position:fixed;bottom:48px;right:12px;z-index:100000;width:300px;"
      + "padding:12px 14px;border-radius:8px;font:12px/1.5 system-ui,sans-serif;color:#e5e7eb;"
      + "background:rgba(17,24,39,0.96);border:1px solid rgba(255,255,255,0.12);"
      + "box-shadow:0 10px 30px rgba(0,0,0,0.45);backdrop-filter:blur(6px);";

    var title = document.createElement("div");
    title.textContent = "Attach to trees/" + tree + ".tree";
    title.style.cssText = "font-weight:600;margin-bottom:8px;";

    var input = document.createElement("input");
    input.type = "text"; input.value = defaultName + "." + ext; input.spellcheck = false;
    input.style.cssText = "width:100%;box-sizing:border-box;padding:5px 7px;margin-bottom:4px;"
      + "border-radius:5px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.35);"
      + "color:#e5e7eb;font:12px/1.4 ui-monospace,monospace;";

    var hint = document.createElement("div");
    hint.textContent = "name or folder/path — drives the file-tree grouping";
    hint.style.cssText = "color:rgba(229,231,235,0.5);margin-bottom:10px;font-size:11px;";

    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px;justify-content:flex-end;";
    function mkBtn(label, primary) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = label;
      b.style.cssText = "padding:5px 10px;border-radius:5px;cursor:pointer;font:12px system-ui,sans-serif;"
        + "border:1px solid rgba(255,255,255,0.18);"
        + (primary ? "background:#16a34a;color:#fff;border-color:#16a34a;" : "background:rgba(255,255,255,0.06);color:#e5e7eb;");
      return b;
    }
    var injectBtn = mkBtn("Inject", true), copyBtn = mkBtn("Copy", false), cancelBtn = mkBtn("Cancel", false);

    var busy = false;
    function run(inject) {
      if (busy) return; busy = true;
      injectBtn.disabled = copyBtn.disabled = true;
      postAttach(file, tree, input.value.trim(), inject).then(function(j) {
        closeAttachDialog();
        if (inject) {
          if (j.injected) {
            // Declaration is in the frontmatter; hand back the \embed snippet so the
            // author can drop the image inline wherever they want it.
            copyText(embedSnippet(j)).then(function() {
              showToast((j.alreadyPresent ? "Already attached: " : "Injected ") + j.key
                + " \u2192 " + (j.targetFile || ("trees/" + tree + ".tree"))
                + " \u2014 \embed snippet copied (paste to show it inline)"
                + (j.alreadyPresent ? "" : "; reload the tree if open in your editor."), true);
            });
          } else {
            copyText(j.declaration + "\n" + j.refSnippet).then(function() {
              showToast("Couldn't inject (" + (j.injectReason || "?") + ") \u2014 declaration copied instead.", false);
            });
          }
        } else {
          copyText(j.declaration + "\n" + j.refSnippet + "\n" + embedSnippet(j)).then(function() {
            showToast("Saved " + j.key + " \u2014 declaration + \embed snippet copied to clipboard.", true);
          });
        }
      }).catch(function(err) { closeAttachDialog(); showToast("Attach failed: " + (err && err.message ? err.message : err), false); });
    }
    injectBtn.addEventListener("click", function() { run(true); });
    copyBtn.addEventListener("click", function() { run(false); });
    cancelBtn.addEventListener("click", function() { closeAttachDialog(); });

    row.appendChild(cancelBtn); row.appendChild(copyBtn); row.appendChild(injectBtn);
    card.appendChild(title); card.appendChild(input); card.appendChild(hint); card.appendChild(row);
    document.body.appendChild(card);
    input.focus(); input.select();
    input.addEventListener("keydown", function(ev) {
      if (ev.key === "Enter") { ev.preventDefault(); run(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); closeAttachDialog(); }
    });
  }

  document.addEventListener("paste", function(e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    var file = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === "file" && items[i].type.indexOf("image/") === 0) { file = items[i].getAsFile(); break; }
    }
    if (!file) return;
    e.preventDefault();
    var m = location.pathname.match(/\/${SITE}\/([^/]+)\//);
    var tree = m ? m[1] : "";
    if (!tree) { showToast("Can't tell which tree this page is \u2014 paste on a /${SITE}/<id>/ page.", false); return; }
    var ext = MIME_EXT[file.type] || "png";
    var d = new Date();
    showAttachDialog(file, tree, ext, "paste-" + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()));
  });

  // Load the dev-only table/figure styling UI (served by the dev server).
  var styleUi = document.createElement("script");
  styleUi.src = "/__dev/style-ui.js";
  document.body.appendChild(styleUi);
})();
</script>`;

// ---------------------------------------------------------------------------
// HTTP + WebSocket servers
// ---------------------------------------------------------------------------

const app = connect();
const wss = new WebSocketServer({ host: BIND_HOST, port: WS_PORT });

console.log(`Live reload WebSocket server on port ${WS_PORT}`);

wss.on("connection", (ws) => {
  if (buildStatus === "building") {
    ws.send(JSON.stringify({ type: "build_start" }));
  } else if (lastBuildEpoch) {
    ws.send(JSON.stringify({ type: "build_done", epoch: lastBuildEpoch }));
  }
});

// ---------------------------------------------------------------------------
// File watchers
// ---------------------------------------------------------------------------

if (SERVE_ONLY) {
  // Docker / serve-only mode: just watch output and debounce into a single reload
  console.log("[mode] serve-only (SERVE_ONLY=1)");

  const outputWatcher = chokidar.watch(ROOT, {
    ignored: /(^|[/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  const scheduleReload = (_filePath: string): void => {
    if (buildStatus !== "building") broadcastBuildStart();
    if (outputDebounceTimer) clearTimeout(outputDebounceTimer);
    outputDebounceTimer = setTimeout(() => {
      broadcastBuildDone();
    }, 1500);
  };

  outputWatcher.on("change", scheduleReload);
  outputWatcher.on("add", scheduleReload);
} else {
  // Host mode: watch trees, run build ourselves
  console.log("[mode] full (watching trees, building automatically)");

  let sourceDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const sourceWatcher = chokidar.watch(TREES_ROOT, {
    ignored: /(^|[/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  });

  const onSourceChange = (): void => {
    // Debounce rapid saves (e.g. multiple tree files changed at once)
    if (sourceDebounceTimer) clearTimeout(sourceDebounceTimer);
    sourceDebounceTimer = setTimeout(() => {
      sourceDebounceTimer = null;
      runBuild();
    }, 300);
  };

  sourceWatcher.on("change", onSourceChange);
  sourceWatcher.on("add", onSourceChange);
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

const getPathAndQuery = (requestUrl: string): { pathOnly: string; query: string } => {
  const [pathOnly, ...queryParts] = requestUrl.split("?");
  const query = queryParts.length > 0 ? `?${queryParts.join("?")}` : "";
  return { pathOnly: pathOnly || "/", query };
};

const toSafeRelativePath = (urlPath: string): string | null => {
  const withoutLeadingSlash = urlPath.replace(/^\/+/, "");
  const normalized = path.posix.normalize(withoutLeadingSlash);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return null;
  return normalized;
};

const injectDevScript = (html: string): string => {
  if (html.includes("</body>")) return html.replace("</body>", `${DEV_SCRIPT}</body>`);
  if (html.includes("</head>")) return html.replace("</head>", `${DEV_SCRIPT}</head>`);
  return `${html}${DEV_SCRIPT}`;
};

// Public-base → internal-base remap. Forester bakes links under /SITE/ (from
// forest.toml's url), but the files live at output/notes/. Rewrite the incoming
// /SITE/… path to /notes/… so every downstream handler (all written against
// /notes/) works for a forest served at any URL. No-op when SITE is already
// "notes". Only /SITE/-prefixed paths are touched, so server-internal routes
// (/__dev/…) are left alone.
if (SITE !== "notes") {
  const base = `/${SITE}`;
  app.use((req, _res, next) => {
    const u = req.url ?? "/";
    if (u === base) req.url = "/notes/";
    else if (u.startsWith(`${base}/`) || u.startsWith(`${base}?`)) {
      req.url = `/notes${u.slice(base.length)}`;
    }
    next();
  });
}

// Directory index resolution
app.use((req, _res, next) => {
  const requestUrl = req.url ?? "/";
  const { pathOnly, query } = getPathAndQuery(requestUrl);

  if (!pathOnly.endsWith("/")) { next(); return; }

  const safeDirectory = toSafeRelativePath(pathOnly);
  if (safeDirectory === null) { next(); return; }

  const indexHtml = path.join(ROOT, safeDirectory, "index.html");
  const indexXml = path.join(ROOT, safeDirectory, "index.xml");

  if (fs.existsSync(indexHtml)) {
    req.url = `${pathOnly}index.html${query}`;
  } else if (fs.existsSync(indexXml)) {
    req.url = `${pathOnly}index.xml${query}`;
  }

  next();
});

// HTML injection
app.use((req, res: ServerResponse, next) => {
  const requestUrl = req.url ?? "/";
  const { pathOnly } = getPathAndQuery(requestUrl);

  if (!pathOnly.endsWith(".html")) { next(); return; }

  const safePath = toSafeRelativePath(pathOnly);
  if (safePath === null) { res.statusCode = 400; res.end("Bad request"); return; }

  const filePath = path.join(ROOT, safePath);
  if (!fs.existsSync(filePath)) { next(); return; }

  const html = fs.readFileSync(filePath, "utf8");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(injectDevScript(html));
});

// Redirect / to the forest's public base (/SITE/).
app.use((req, res: ServerResponse, next) => {
  if (req.url === "/" || req.url === "") {
    res.writeHead(302, { Location: `/${SITE}/` });
    res.end();
    return;
  }
  next();
});

// ---------------------------------------------------------------------------
// Dev-mode artifact upload  (Phase 2/3 — assisted paste)
//
// POST /__dev/attach?tree=<id>&name=<key>[&inject=1]  with the raw image bytes
// as the body. Writes the image into assets/<tree>/<key>.<ext> and returns the
// ready-to-paste artifact declaration + inline-ref snippet. With inject=1 it ALSO
// splices the \meta{artifact-file:…} line into the frontmatter of trees/<id>.tree
// (Phase 3), which the trees/ watcher then rebuilds; without it the tree is left
// untouched (Phase 2) and the asset is planted by the next normal build. The
// <key> may contain "/" to nest the artifact under folders in the file-tree view.
// Loopback-only.
// ---------------------------------------------------------------------------

const EXT_BY_MIME: Readonly<Record<string, string>> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
  "image/webp": "webp", "image/svg+xml": "svg", "image/avif": "avif",
};
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Keep filenames to a safe charset and prevent path traversal in the tree/name segments.
const sanitizeSegment = (s: string): string =>
  s.replaceAll(/[^a-zA-Z0-9._-]/g, "-").replace(/^[.]+/, "").slice(0, 64);

// A "/"-separated key: sanitize each segment (blocking traversal) but keep the
// slashes so the artifact nests under folders in the rendered file-tree.
const sanitizeKeyPath = (name: string): string =>
  name.split("/").map(sanitizeSegment).filter((s) => s.length > 0).join("/");

const isLoopback = (remote: string | undefined): boolean =>
  remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";

// Frontmatter-only insertion: forester treats a \meta inside rendered content as a
// hard error, so injected lines must land in the leading frontmatter run.
const FRONTMATTER_CMD =
  /^\s*\\(title|taxon|date|author|contributor|tag|meta|parent|number|route|uri|display-uri|source-path|import|export|def|put|namespace)\b/;
const ARTIFACT_META = /^\s*\\meta\{artifact-(?:file|note):/;

/** Line index at which to splice a frontmatter \meta. The search is bounded to
 *  the LEADING frontmatter region (blank lines + frontmatter commands, up to the
 *  first body line) so that \meta lines appearing later inside a body codeblock /
 *  \startverb block are never matched. Within that region: group after the last
 *  existing artifact meta; else insert at the end of the region (before the
 *  blank/body); else 0 (top). Never inside body content. */
const frontmatterInsertIndex = (lines: readonly string[]): number => {
  let end = 0; // first body line (exclusive upper bound of the frontmatter region)
  for (; end < lines.length; end += 1) {
    const line = lines[end]!;
    if (line.trim() === "" || FRONTMATTER_CMD.test(line)) continue;
    break;
  }
  let lastArtifact = -1;
  for (let i = 0; i < end; i += 1) if (ARTIFACT_META.test(lines[i]!)) lastArtifact = i;
  if (lastArtifact !== -1) return lastArtifact + 1;
  let idx = end; // back up over trailing blank lines so we insert after the last command
  while (idx > 0 && lines[idx - 1]!.trim() === "") idx -= 1;
  return idx;
};

app.use((req, res: ServerResponse, next) => {
  const { pathOnly, query } = getPathAndQuery(req.url ?? "/");
  if (pathOnly !== "/__dev/attach") { next(); return; }
  if (req.method !== "POST") { res.statusCode = 405; res.end("Method Not Allowed"); return; }
  if (!isLoopback(req.socket.remoteAddress ?? undefined)) { res.statusCode = 403; res.end("Forbidden"); return; }

  const mime = (req.headers["content-type"] ?? "").split(";")[0]!.trim();
  const ext = EXT_BY_MIME[mime];
  if (!ext) { res.statusCode = 415; res.end(`Unsupported image type: ${mime || "(none)"}`); return; }

  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const tree = sanitizeSegment(params.get("tree") ?? "") || "misc";

  const chunks: Buffer[] = [];
  let total = 0;
  req.on("data", (c: Buffer) => {
    total += c.length;
    if (total > MAX_UPLOAD_BYTES) { res.statusCode = 413; res.end("Payload too large"); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("error", () => { if (!res.writableEnded) { res.statusCode = 500; res.end("Upload error"); } });
  req.on("end", () => {
    if (res.writableEnded) return;
    const body = Buffer.concat(chunks);
    if (body.length === 0) { res.statusCode = 400; res.end("Empty body"); return; }

    // Path-keyed name → display key (folders preserved). The ext is authoritative
    // from the MIME; strip one the author may have typed into the name.
    // eslint-disable-next-line security/detect-non-literal-regexp -- built from the hardcoded EXT_BY_MIME const
    const stripExt = new RegExp(String.raw`\.(?:${Object.values(EXT_BY_MIME).join("|")})$`, "i");
    const keyBase = sanitizeKeyPath((params.get("name") ?? "").replace(stripExt, ""))
      || `paste-${formatTimestamp().replaceAll(':', "")}`;
    const dir = path.posix.dirname(keyBase);            // "." when flat
    const baseName = path.posix.basename(keyBase);
    const idealKey = dir === "." ? `${baseName}.${ext}` : `${dir}/${baseName}.${ext}`;

    const json = (extra: Record<string, unknown>, key: string): void => {
      const relPath = path.posix.join("assets", tree, key);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        relPath, key,
        declaration: String.raw`\meta{artifact-file:${key}}{\route-asset{${relPath}}}`,
        refSnippet: String.raw`\link{#artifact:${key}}{↗}`,
        ...extra,
      }));
    };

    // Resolve the inject target (if requested) up-front so idempotency can run.
    const wantInject = params.get("inject") === "1";
    let targetAbs: string | null = null;
    let targetFile: string | undefined;
    if (wantInject) {
      const safeRel = toSafeRelativePath(`${tree}.tree`);
      const abs = safeRel ? path.join(TREES_ROOT, `${tree}.tree`) : null;
      if (abs && fs.existsSync(abs)) { targetAbs = abs; targetFile = `trees/${tree}.tree`; }
    }

    // Idempotent fast-path: the tree already declares this exact key — don't write a
    // second asset (which would collision-rename) or duplicate the meta line.
    if (targetAbs && fs.readFileSync(targetAbs, "utf8").includes(`artifact-file:${idealKey}}`)) {
      json({ injected: true, alreadyPresent: true, injectReason: "", targetFile }, idealKey);
      return;
    }

    // New artifact: write the asset (collision-renamed to a unique on-disk name).
    const destDir = path.join(ASSETS_ROOT, tree, dir === "." ? "" : dir);
    fs.mkdirSync(destDir, { recursive: true });
    let finalBase = `${baseName}.${ext}`;
    let collision = 1;
    while (fs.existsSync(path.join(destDir, finalBase))) {
      finalBase = `${baseName}-${collision}.${ext}`;
      collision += 1;
    }
    fs.writeFileSync(path.join(destDir, finalBase), body);
    const key = dir === "." ? finalBase : `${dir}/${finalBase}`;

    let injected = false, injectReason = "";
    if (wantInject && targetAbs) {
      const lines = fs.readFileSync(targetAbs, "utf8").split(/\r?\n/);
      const at = frontmatterInsertIndex(lines);
      lines.splice(at, 0, String.raw`\meta{artifact-file:${key}}{\route-asset{${path.posix.join("assets", tree, key)}}}`);
      fs.writeFileSync(targetAbs, lines.join("\n"));
      injected = true;
      console.log(`[attach] injected into ${targetFile} at line ${at + 1}`);
    } else if (wantInject) {
      injectReason = `source tree trees/${tree}.tree not found`;
    }

    console.log(`[attach] wrote assets/${tree}/${key}${wantInject ? ` (injected=${injected})` : ""}`);
    json({ injected, alreadyPresent: false, injectReason, targetFile }, key);
  });
});

// ---------------------------------------------------------------------------
// Dev-mode block styling  (tables & figures)
//
// POST /__dev/style?tree=<id>&id=<style-id>  with the style string as the body
// (e.g. "align=center width=70 cols=120,80"). Append/replace (or delete, when the
// body is empty) the `\meta{style:<style-id>}{…}` line in the tree's frontmatter.
// A single frontmatter-line edit keyed by an exact id — no body parsing.
// Loopback-only.
// ---------------------------------------------------------------------------

const setStyleMeta = (
  lines: string[],
  styleId: string,
  value: string,
): { action: "inserted" | "replaced" | "removed" | "noop" } => {
  const esc = styleId.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  // eslint-disable-next-line security/detect-non-literal-regexp -- `esc` is regex-escaped above
  const re = new RegExp(String.raw`^\s*\\meta\{style:${esc}\}\{`);
  // Search only the leading frontmatter region (so a style: text inside a body
  // codeblock is never matched), reusing the FRONTMATTER_CMD scan.
  let end = 0;
  for (; end < lines.length; end += 1) {
    const l = lines[end]!;
    if (l.trim() === "" || FRONTMATTER_CMD.test(l)) continue;
    break;
  }
  let existing = -1;
  for (let i = 0; i < end; i += 1) if (re.test(lines[i]!)) { existing = i; break; }

  if (value === "") {
    if (existing === -1) return { action: "noop" };
    lines.splice(existing, 1);
    return { action: "removed" };
  }
  const line = String.raw`\meta{style:${styleId}}{${value}}`;
  if (existing !== -1) { lines[existing] = line; return { action: "replaced" }; }
  lines.splice(frontmatterInsertIndex(lines), 0, line);
  return { action: "inserted" };
};

app.use((req, res: ServerResponse, next) => {
  const { pathOnly, query } = getPathAndQuery(req.url ?? "/");
  if (pathOnly !== "/__dev/style") { next(); return; }
  if (req.method !== "POST") { res.statusCode = 405; res.end("Method Not Allowed"); return; }
  if (!isLoopback(req.socket.remoteAddress ?? undefined)) { res.statusCode = 403; res.end("Forbidden"); return; }

  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const tree = sanitizeSegment(params.get("tree") ?? "");
  const styleId = (params.get("id") ?? "").trim();
  if (!tree || !styleId) { res.statusCode = 400; res.end("Missing tree or id"); return; }
  const safeRel = toSafeRelativePath(`${tree}.tree`);
  const abs = safeRel ? path.join(TREES_ROOT, `${tree}.tree`) : null;
  if (!abs || !fs.existsSync(abs)) { res.statusCode = 404; res.end(`Tree trees/${tree}.tree not found`); return; }

  const chunks: Buffer[] = [];
  let total = 0;
  req.on("data", (c: Buffer) => {
    total += c.length;
    if (total > 4096) { res.statusCode = 413; res.end("Payload too large"); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("error", () => { if (!res.writableEnded) { res.statusCode = 500; res.end("Style error"); } });
  req.on("end", () => {
    if (res.writableEnded) return;
    // Style values are a flat "k=v" grammar; strip braces defensively.
    const value = Buffer.concat(chunks).toString("utf-8").trim().replaceAll(/[{}]/g, "");
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    const { action } = setStyleMeta(lines, styleId, value);
    if (action !== "noop") fs.writeFileSync(abs, lines.join("\n"));
    console.log(`[style] ${action} style:${styleId} in trees/${tree}.tree`);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, action, id: styleId }));
  });
});

// Serve the dev-only styling UI (localhost; never part of published output). It's
// authored in strict TS (scripts/dev/style-ui.ts) and type-stripped on the fly by
// esbuild so the browser gets plain JS.
const STYLE_UI_PATH = path.join(PROJECT_ROOT, "scripts", "dev", "style-ui.ts");
app.use((req, res: ServerResponse, next) => {
  const { pathOnly } = getPathAndQuery(req.url ?? "/");
  if (pathOnly !== "/__dev/style-ui.js") { next(); return; }
  if (!isLoopback(req.socket.remoteAddress ?? undefined) || !fs.existsSync(STYLE_UI_PATH)) {
    res.statusCode = 404; res.end("Not found"); return;
  }
  esbuild.transform(fs.readFileSync(STYLE_UI_PATH, "utf8"), { loader: "ts", target: "es2019" })
    .then(({ code }) => {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.end(code);
    })
    .catch((error: unknown) => {
      res.statusCode = 500;
      res.end(`// style-ui transform error: ${error instanceof Error ? error.message : String(error)}`);
    });
});

app.use(serveStatic(ROOT));

const server = app.listen(PORT, BIND_HOST, () => {
  console.log(`Server running at http://${BIND_HOST}:${PORT}/${SITE}/`);
  console.log(`Serving files from: ${ROOT}`);
  if (!RAW_SITE_SEGMENT) {
    console.warn(
      "[warn] forest.toml `url` has no path segment; serving under /notes/. " +
        "Set a path (e.g. https://<you>.github.io/<repo>/) so local links match the deployed site.",
    );
  }
  if (!SERVE_ONLY) console.log(`Watching sources: ${TREES_ROOT}`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

const shutdown = (): void => {
  console.log("\n[server] shutting down...");
  // Build runs in-process now; let any in-flight stage finish naturally.
  wss.close();
  server.close(() => process.exit(0));
  // Force exit if server doesn't close within 3s
  setTimeout(() => process.exit(1), 3000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGTSTP", shutdown);

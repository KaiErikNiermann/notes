/*
 * Dev-only visual styling for tables & figures (strict TypeScript).
 *
 * Served — type-stripped by esbuild — at /__dev/style-ui.js by the dev server
 * (server.ts), injected only on localhost; never part of the published output.
 * Decorates each
 *   figure.embed-image[data-style-id]   and   table.data-table[data-style-id]
 * on hover with a small toolbar (align L/C/R + width %) and drag handles (a
 * side-agnostic right-edge width handle, and per-column handles on tables —
 * Notion-grow). Live preview applies inline styles; on commit it POSTs the
 * serialized style to /__dev/style, which appends/replaces the
 * `\meta{style:<id>}{…}` frontmatter line. No body markup is touched.
 *
 * Typechecked via scripts/dev/tsconfig.json (DOM lib); excluded from the Node
 * program in the root tsconfig.
 */

type Align = "left" | "center" | "right";

interface StyleState {
  align: Align | null;
  width: number | null; // percent
  cols: number[] | null; // per-column px widths (tables only)
}

interface ColHandle {
  readonly el: HTMLDivElement;
  readonly cell: HTMLElement;
}

interface Overlay {
  readonly root: HTMLDivElement;
  readonly bar: HTMLDivElement;
  readonly edge: HTMLDivElement;
  readonly widthInput: HTMLInputElement;
  readonly cols: readonly ColHandle[];
}

(() => {
  "use strict";
  if (!(location.hostname === "localhost" || location.hostname === "127.0.0.1")) return;
  const win = window as Window & { __styleUiLoaded?: boolean };
  if (win.__styleUiLoaded) return;
  win.__styleUiLoaded = true;

  const SELECTOR = "figure.embed-image[data-style-id], table.data-table[data-style-id]";
  const MIN_WIDTH = 10; // %
  const MIN_COL = 24; // px

  const ALIGNS: ReadonlySet<string> = new Set(["left", "center", "right"]);
  const isAlign = (s: string): s is Align => ALIGNS.has(s);

  // Per-block state, kept off the DOM (no monkey-patching of element properties).
  const stateMap = new WeakMap<HTMLElement, StyleState>();
  const timerMap = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

  // ---- lucide-style text-align icons (left / center / right) ----------------
  const alignSvg = (lines: string): string =>
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + lines + "</svg>";
  const SVG_LEFT = alignSvg('<line x1="21" y1="6" x2="3" y2="6"/><line x1="15" y1="12" x2="3" y2="12"/><line x1="17" y1="18" x2="3" y2="18"/>');
  const SVG_CENTER = alignSvg('<line x1="21" y1="6" x2="3" y2="6"/><line x1="17" y1="12" x2="7" y2="12"/><line x1="19" y1="18" x2="5" y2="18"/>');
  const SVG_RIGHT = alignSvg('<line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="9" y2="12"/><line x1="21" y1="18" x2="7" y2="18"/>');

  // ---- toast ----------------------------------------------------------------
  const toast = (msg: string, ok = true): void => {
    const t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText =
      "position:fixed;bottom:84px;right:12px;z-index:100001;max-width:40ch;padding:6px 10px;" +
      "border-radius:6px;font:12px/1.4 system-ui,sans-serif;color:#fff;background:" +
      (ok ? "rgba(30,64,120,.92)" : "rgba(153,27,27,.92)") +
      ";box-shadow:0 6px 20px rgba(0,0,0,.35);opacity:0;transition:opacity .25s;";
    document.body.append(t);
    requestAnimationFrame(() => { t.style.opacity = "1"; });
    setTimeout(() => { t.style.opacity = "0"; setTimeout(() => { t.remove(); }, 300); }, 2200);
  };

  // ---- style state <-> data-style string ------------------------------------
  const parseStyle = (s: string | null): StyleState => {
    const st: StyleState = { align: null, width: null, cols: null };
    if (!s) return st;
    for (const tok of s.split(" ")) {
      const i = tok.indexOf("=");
      if (i === -1) continue;
      const k = tok.slice(0, i);
      const v = tok.slice(i + 1);
      switch (k) {
      case "align": { if (isAlign(v)) st.align = v; 
      break;
      }
      case "width": { const n = Number.parseFloat(v); if (!Number.isNaN(n)) st.width = n; 
      break;
      }
      case "cols": { const c = v.split(",").map(Number).filter((n) => n > 0); if (c.length > 0) st.cols = c; 
      break;
      }
      // No default
      }
    }
    return st;
  };
  const serialize = (st: StyleState): string => {
    const p: string[] = [];
    if (st.align) p.push("align=" + st.align);
    if (st.width !== null && !Number.isNaN(st.width)) p.push("width=" + Math.round(st.width));
    if (st.cols && st.cols.length > 0) p.push("cols=" + st.cols.map((n) => Math.round(n)).join(","));
    return p.join(" ");
  };
  const stateOf = (b: HTMLElement): StyleState => {
    let st = stateMap.get(b);
    if (!st) { st = parseStyle(b.dataset.style ?? null); stateMap.set(b, st); }
    return st;
  };

  // ---- live application (mirrors the renderer) ------------------------------
  const isTable = (b: HTMLElement): b is HTMLTableElement => b.tagName === "TABLE";
  const sizingEl = (b: HTMLElement): HTMLElement => (isTable(b) ? b : b.querySelector("img") ?? b);

  const applyAlign = (el: HTMLElement, align: Align | null): void => {
    el.style.marginLeft = ""; el.style.marginRight = ""; el.style.marginInline = "";
    switch (align) {
    case "left": { el.style.marginRight = "auto"; el.style.marginLeft = "0"; 
    break;
    }
    case "right": { el.style.marginLeft = "auto"; el.style.marginRight = "0"; 
    break;
    }
    case "center": { el.style.marginInline = "auto"; 
    break;
    }
    // No default
    }
  };
  const ensureColgroup = (t: HTMLTableElement, cols: readonly number[]): void => {
    let cg = t.querySelector("colgroup");
    if (!cg) { cg = document.createElement("colgroup"); t.insertBefore(cg, t.firstChild); }
    while (cg.children.length < cols.length) cg.append(document.createElement("col"));
    while (cg.children.length > cols.length) cg.lastElementChild?.remove();
    for (const [i, wpx] of cols.entries()) {
      const col = cg.children[i];
      if (col instanceof HTMLElement) col.style.width = Math.round(wpx) + "px";
    }
  };
  const apply = (b: HTMLElement, st: StyleState): void => {
    if (isTable(b)) {
      applyAlign(b, st.align);
      if (st.cols && st.cols.length > 0) {
        b.style.tableLayout = "fixed";
        b.style.width = Math.round(st.cols.reduce((a, c) => a + c, 0)) + "px";
        ensureColgroup(b, st.cols);
      } else {
        b.style.tableLayout = "";
        b.style.width = st.width === null ? "" : Math.round(st.width) + "%";
        b.querySelector("colgroup")?.remove();
      }
    } else {
      const img = b.querySelector("img");
      if (img) {
        applyAlign(img, st.align);
        img.style.width = st.width === null ? "" : Math.round(st.width) + "%";
      }
    }
  };

  // ---- writeback (debounced, per-block) -------------------------------------
  const commit = (b: HTMLElement): void => {
    clearTimeout(timerMap.get(b));
    timerMap.set(b, setTimeout(() => {
      const m = location.pathname.match(/\/notes\/([^/]+)\//);
      const tree = m?.[1] ?? "";
      const id = b.dataset.styleId;
      if (!tree || !id) return;
      void fetch("/__dev/style?tree=" + encodeURIComponent(tree) + "&id=" + encodeURIComponent(id), {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: serialize(stateOf(b)),
      })
        .then((r) => { if (!r.ok) { throw new Error("HTTP " + r.status); } return r.json() as Promise<{ action?: string }>; })
        .then((j) => { toast("styled → " + (j.action ?? "ok")); })
        .catch((error: unknown) => { toast("style write failed: " + (error instanceof Error ? error.message : String(error)), false); });
    }, 250));
  };

  // ---- overlay (toolbar + handles) ------------------------------------------
  let active: HTMLElement | null = null;
  let overlay: Overlay | null = null;
  let dragging = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const px = (n: number): string => Math.round(n) + "px";
  const clearOverlay = (): void => { overlay?.root.remove(); overlay = null; active = null; };

  const mkBtn = (html: string, title: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button"; b.innerHTML = html; b.title = title;
    b.style.cssText =
      "min-width:24px;height:24px;padding:0 5px;border-radius:4px;cursor:pointer;" +
      "display:inline-flex;align-items:center;justify-content:center;" +
      "border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#e5e7eb;" +
      "font:12px system-ui,sans-serif;";
    return b;
  };

  const positionColHandle = (h: ColHandle): void => {
    if (!active) return;
    const cr = h.cell.getBoundingClientRect();
    h.el.style.left = px(cr.right - 3);
    h.el.style.top = px(cr.top);
    h.el.style.height = px(active.getBoundingClientRect().height);
  };

  const reposition = (): void => {
    if (!active || !overlay) return;
    const r = active.getBoundingClientRect();
    // toolbar: centered above the block, clamped on-screen, clear of the handles
    const bar = overlay.bar;
    const bx = r.left + (r.width - bar.offsetWidth) / 2;
    bar.style.left = px(Math.max(4, Math.min(bx, window.innerWidth - bar.offsetWidth - 4)));
    bar.style.top = px(Math.max(4, r.top - bar.offsetHeight - 8));
    // width edge handle: always the right edge (resize is side-agnostic)
    const sr = sizingEl(active).getBoundingClientRect();
    overlay.edge.style.left = px(sr.right - 3);
    overlay.edge.style.top = px(sr.top);
    overlay.edge.style.height = px(sr.height);
    for (const handle of overlay.cols) positionColHandle(handle);
  };

  const headerCells = (table: HTMLTableElement): HTMLElement[] => {
    const tr = table.querySelector("tr");
    if (!tr) return [];
    return [...tr.children].filter(
      (c): c is HTMLElement => c instanceof HTMLElement && (c.tagName === "TH" || c.tagName === "TD"),
    );
  };

  const decorate = (block: HTMLElement): void => {
    clearTimeout(hideTimer);
    if (active === block) return;
    clearOverlay();
    active = block;
    const st = stateOf(block);

    const root = document.createElement("div");
    root.style.cssText = "position:fixed;inset:0;z-index:100000;pointer-events:none;";

    // toolbar ------------------------------------------------------------------
    const bar = document.createElement("div");
    bar.style.cssText =
      "position:fixed;pointer-events:auto;display:flex;gap:4px;align-items:center;padding:4px 6px;" +
      "border-radius:7px;background:rgba(17,24,39,.96);border:1px solid rgba(255,255,255,.12);" +
      "box-shadow:0 6px 18px rgba(0,0,0,.4);";
    const bL = mkBtn(SVG_LEFT, "Align left");
    const bC = mkBtn(SVG_CENTER, "Center");
    const bR = mkBtn(SVG_RIGHT, "Align right");
    const markAlign = (): void => {
      for (const [a, btn] of ([["left", bL], ["center", bC], ["right", bR]] as const)) {
        btn.style.background = st.align === a ? "#1e40c8" : "rgba(255,255,255,.06)";
      }
    };
    const widthInput = document.createElement("input");
    widthInput.type = "number"; widthInput.min = "10"; widthInput.max = "100"; widthInput.title = "width %";
    widthInput.value = st.width === null ? "" : String(Math.round(st.width));
    widthInput.style.cssText =
      "width:46px;height:22px;padding:0 4px;border-radius:4px;border:1px solid rgba(255,255,255,.18);" +
      "background:rgba(0,0,0,.35);color:#e5e7eb;font:12px ui-monospace,monospace;";
    const setAlign = (a: Align): void => { st.align = a; apply(block, st); reposition(); commit(block); markAlign(); };
    bL.addEventListener('click', () => setAlign("left"));
    bC.addEventListener('click', () => setAlign("center"));
    bR.addEventListener('click', () => setAlign("right"));
    widthInput.addEventListener('input', () => {
      const v = Number.parseFloat(widthInput.value);
      st.width = Number.isNaN(v) ? null : Math.max(MIN_WIDTH, Math.min(100, v));
      if (isTable(block) && st.cols) st.cols = null; // width mode clears explicit cols
      apply(block, st); reposition(); commit(block);
    });
    const reset = mkBtn("✕", "Reset");
    reset.addEventListener('click', () => {
      const cleared: StyleState = { align: null, width: null, cols: null };
      stateMap.set(block, cleared);
      block.style.cssText = "";
      block.querySelector("colgroup")?.remove();
      const img = block.querySelector("img");
      if (img) img.style.width = "";
      commit(block);
      clearOverlay();
    });
    bar.append(bL, bC, bR, widthInput, reset);
    markAlign();
    root.append(bar);

    // width edge handle --------------------------------------------------------
    const edge = document.createElement("div");
    edge.style.cssText =
      "position:fixed;width:6px;cursor:ew-resize;pointer-events:auto;" +
      "background:transparent;border-right:2px solid rgba(59,130,246,.55);";
    edge.addEventListener('mouseenter', () => { edge.style.borderRightColor = "rgba(59,130,246,.95)"; });
    edge.addEventListener('mouseleave', () => { edge.style.borderRightColor = "rgba(59,130,246,.55)"; });
    edge.addEventListener("pointerdown", (e: PointerEvent) => {
      e.preventDefault(); dragging = true;
      try { edge.setPointerCapture(e.pointerId); } catch { /* synthetic / unsupported */ }
      const sz = sizingEl(block);
      const container = (isTable(block) ? block.parentElement ?? block : block).getBoundingClientRect();
      const startX = e.clientX;
      const startWpx = sz.getBoundingClientRect().width;
      // A centered block grows from both sides, so its right edge moves half as
      // fast as the width — double the delta so the right-edge handle tracks.
      const factor = st.align === "left" || st.align === "right" ? 1 : 2;
      const move = (ev: PointerEvent): void => {
        const wpx = startWpx + (ev.clientX - startX) * factor;
        const pct = Math.max(MIN_WIDTH, Math.min(100, Math.round((wpx / container.width) * 100)));
        st.width = pct; if (isTable(block)) st.cols = null;
        widthInput.value = String(pct); apply(block, st); reposition();
      };
      const up = (): void => {
        dragging = false;
        try { edge.releasePointerCapture(e.pointerId); } catch { /* */ }
        edge.removeEventListener("pointermove", move); edge.removeEventListener("pointerup", up);
        commit(block);
      };
      edge.addEventListener("pointermove", move); edge.addEventListener("pointerup", up);
    });
    root.append(edge);

    // per-column handles (tables, Notion-grow) ---------------------------------
    const cols: ColHandle[] = [];
    if (isTable(block)) {
      const cells = headerCells(block);
      for (const [i, cell] of cells.slice(0, -1).entries()) {
        const el = document.createElement("div");
        el.style.cssText =
          "position:fixed;width:7px;margin-left:-3px;cursor:col-resize;pointer-events:auto;" +
          "border-right:2px solid rgba(168,85,247,.5);";
        el.addEventListener('mouseenter', () => { el.style.borderRightColor = "rgba(168,85,247,.95)"; });
        el.addEventListener('mouseleave', () => { el.style.borderRightColor = "rgba(168,85,247,.5)"; });
        el.addEventListener("pointerdown", (e: PointerEvent) => {
          e.preventDefault(); dragging = true;
          try { el.setPointerCapture(e.pointerId); } catch { /* */ }
          if (!st.cols) st.cols = cells.map((c) => c.getBoundingClientRect().width);
          const colsArr = st.cols;
          const startX = e.clientX;
          const startW = colsArr[i] ?? MIN_COL;
          // Centered tables re-center as they grow, so the dragged boundary moves
          // half as fast as the column — double the delta to track it.
          const factor = st.align === "left" || st.align === "right" ? 1 : 2;
          const move = (ev: PointerEvent): void => {
            colsArr[i] = Math.max(MIN_COL, startW + (ev.clientX - startX) * factor);
            apply(block, st); reposition();
          };
          const up = (): void => {
            dragging = false;
            try { el.releasePointerCapture(e.pointerId); } catch { /* */ }
            el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up);
            commit(block);
          };
          el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
        });
        root.append(el);
        cols.push({ el, cell });
      }
    }

    document.body.append(root);
    overlay = { root, bar, edge, widthInput, cols };
    reposition();
  };

  const scheduleHide = (): void => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!dragging) clearOverlay(); }, 350);
  };

  document.addEventListener("pointerover", (e: PointerEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    const block = target?.closest(SELECTOR);
    if (block instanceof HTMLElement) { decorate(block); return; }
    if (overlay && target && (target === overlay.root || overlay.root.contains(target))) { clearTimeout(hideTimer); return; }
    if (active) scheduleHide();
  });
  window.addEventListener("scroll", () => { if (!dragging) reposition(); }, true);
  window.addEventListener("resize", () => { if (!dragging) reposition(); });
})();

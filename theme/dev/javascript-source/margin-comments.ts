/*
 * margin-comments.ts — Word-style margin comments / asides.
 *
 * The renderer emits, inline, `<span class="comment-anchor" data-comment="<id>">`
 * around a phrase (a persistent background highlight marks commented text), plus a
 * per-tree `<aside class="comments">` of `<div class="comment-card" id="cmt-<id>">`
 * note cards (a readable end-of-tree list with no JS). This module lifts those cards
 * into a right-margin rail and draws a thin dashed line from each phrase to its card.
 *
 * Overflow model — per-paragraph DISCRETE SCROLLBOX: every commented paragraph gets
 * a fixed-height clip box (its band `[para.top, nextCommentedPara.top)`) holding its
 * cards stacked. Only a contiguous window of cards shows; the rest are clipped above/
 * below (invisible — they don't push the page or other paragraphs). Wheel (and the
 * ↑/↓ accents) step the window one card at a time, instantly. Two subtle accents show
 * how many cards are hidden above/below, so a 1-comment and a 12-comment paragraph
 * look identical except for those accents. Clicking a phrase whose card is scrolled
 * out jumps its box to that card ("jump to message"). Falls back to tap-to-reveal on
 * narrow screens.
 */

const RAIL_MQ = "(min-width: 1080px)";
const CARD_GAP = 10; // px between stacked cards (must match .comment-stack `gap`)
const BLOCK_SEL = "p, li, blockquote, figcaption, dd, dt, td, th";
const HIDE_KEY = "margin-comments-hidden"; // persisted "fold the rail into tap-to-reveal"
const WHEEL_NOTCH = 40; // px of wheel delta per one-card step (trackpad throttle)
const JUMP_CONTEXT = 1; // cards of context to show around a jump target

interface Pair {
  readonly anchor: HTMLElement;
  readonly card: HTMLElement;
  readonly id: string; // the data-comment value, resolved once
}

// One commented paragraph's scrollbox: a clip viewport over a stack of its cards,
// windowed by `offset` (index of the first visible card).
interface GroupState {
  readonly pairs: readonly Pair[];
  readonly group: HTMLElement; // .comment-group (positioned at the band)
  readonly stack: HTMLElement; // .comment-stack (the translated inner column)
  readonly up: HTMLButtonElement; // ↑ accent
  readonly down: HTMLButtonElement; // ↓ accent
  offset: number; // first visible card index
  heights: number[]; // per-card border-box height (no gap)
  bandHeight: number; // clip height in px
  visEnd: number; // exclusive end of the visible window
  accum: number; // wheel-delta accumulator
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const debounce = (fn: () => void, ms: number): (() => void) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
};

const div = (cls: string): HTMLDivElement => {
  const d = document.createElement("div");
  d.className = cls;
  return d;
};

const makeAccent = (dir: "up" | "down"): HTMLButtonElement => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `comment-accent comment-accent--${dir}`;
  b.hidden = true;
  b.setAttribute("aria-label", dir === "up" ? "Show earlier comments" : "Show later comments");
  return b;
};

// The block that "owns" an anchor (for banding / inline reveal placement).
const blockOf = (anchor: HTMLElement): Element | null =>
  anchor.closest(BLOCK_SEL) ?? anchor.parentElement;

// A standalone copy of a card's note body for inline (mobile) reveals: strip the id
// (no duplicates in the DOM), the inline positioning, and the backref.
const cloneCardBody = (card: HTMLElement): HTMLElement => {
  const clone = card.cloneNode(true) as HTMLElement;
  clone.removeAttribute("id");
  clone.style.cssText = "";
  clone.querySelector(".comment-backref")?.remove();
  return clone;
};

export const initMarginComments = (): void => {
  const article = document.querySelector<HTMLElement>("article");
  if (!article) return;
  // Only the page's OWN comments belong in the rail. Transcluded sibling/related
  // trees (rendered into the backmatter <footer>, or as nested transclusions)
  // carry along their own .comment-anchor markup; counting those would light up
  // the hide-comments toggle on pages with no comments of their own. A native
  // anchor's nearest <section> is the article's top-level section; a transcluded
  // one's nearest <section> is the transclusion's deeper section (or sits in the
  // <footer>), so it won't match.
  const mainSection = article.querySelector(":scope > section");
  const pairs: Pair[] = [];
  for (const anchor of document.querySelectorAll<HTMLElement>(".comment-anchor[data-comment]")) {
    if (anchor.closest("section") !== mainSection) continue;
    const id = anchor.dataset["comment"];
    const card = id ? document.getElementById(`cmt-${id}`) : null;
    if (card && id) pairs.push({ anchor, card, id });
  }
  if (pairs.length === 0) return;

  document.documentElement.classList.add("has-margin-comments");
  article.style.position = "relative";
  const layer = div("comments-layer");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "comment-lines");
  article.append(svg, layer);

  const metrics = (): { aRect: DOMRect; proseRight: number } => {
    const aRect = article.getBoundingClientRect();
    const section = article.querySelector<HTMLElement>("section");
    const proseRight = (section ? section.getBoundingClientRect().right : aRect.right) - aRect.left;
    return { aRect, proseRight };
  };

  // ---- connecting line ----------------------------------------------------
  // Runs from the end of the highlighted text, just below its row, out to the
  // gutter, then curves to the card. Reads the card's live rect, so it's correct
  // wherever the card currently sits in its (translated) stack.
  const drawLine = (p: Pair, aRect: DOMRect, proseRight: number, active: boolean): void => {
    const rects = p.anchor.getClientRects();
    const last = rects.length > 0 ? rects[rects.length - 1] : p.anchor.getBoundingClientRect();
    const ax = last.right - aRect.left;
    const ay = last.bottom - aRect.top + 2;
    const cr = p.card.getBoundingClientRect();
    const cx = cr.left - aRect.left;
    const cy = cr.top - aRect.top + 12;
    const gx = Math.max(ax, proseRight);
    const midX = gx + (cx - gx) * 0.5;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${ax} ${ay} L ${gx} ${ay} C ${midX} ${ay}, ${midX} ${cy}, ${cx} ${cy}`);
    path.setAttribute("class", "comment-line" + (active ? " comment-line--active" : ""));
    path.dataset["comment"] = p.id;
    svg.append(path);
  };
  const removeLines = (id: string): void =>
    { for (const l of svg.querySelectorAll(`.comment-line[data-comment="${id}"]`)) l.remove() };

  // ---- reciprocal emphasis (anchor ⇄ card ⇄ line) -------------------------
  const setActive = (p: Pair, state: boolean): void => {
    p.anchor.classList.toggle("comment-anchor--active", state);
    p.card.classList.toggle("comment-card--active", state);
    for (const l of svg.querySelectorAll(`.comment-line[data-comment="${p.id}"]`)) l.classList.toggle("comment-line--active", state);
  };

  // ---- build one scrollbox per commented paragraph (once) -----------------
  const groupByBlock = (): Pair[][] => {
    const out: Pair[][] = [];
    let cur: Element | null = null;
    for (const p of pairs) {
      const block = blockOf(p.anchor);
      if (block !== cur) { out.push([]); cur = block; }
      out[out.length - 1].push(p);
    }
    return out;
  };

  const groups: GroupState[] = groupByBlock().map((gp) => {
    const groupEl = div("comment-group");
    const up = makeAccent("up");
    const down = makeAccent("down");
    const clip = div("comment-clip");
    const stack = div("comment-stack");
    for (const p of gp) stack.append(p.card); // cards live in the stack now
    clip.append(stack);
    groupEl.append(up, clip, down);
    layer.append(groupEl);
    const g: GroupState = {
      pairs: gp, group: groupEl, stack, up, down,
      offset: 0, heights: [], bandHeight: 0, visEnd: gp.length, accum: 0,
    };
    up.addEventListener("click", () => step(g, -1));
    down.addEventListener("click", () => step(g, 1));
    groupEl.addEventListener("wheel", (e) => onWheel(e, g), { passive: false });
    return g;
  });

  const groupOf = (p: Pair): GroupState | undefined => groups.find((g) => g.pairs.includes(p));
  const isVisible = (g: GroupState, i: number): boolean => i >= g.offset && i < g.visEnd;

  // ---- windowing ----------------------------------------------------------
  // Greedy fit from `offset`; always ≥1 card (handles a card taller than the band).
  const computeVisEnd = (g: GroupState, offset: number): number => {
    let acc = 0, end = offset;
    for (let i = offset; i < g.pairs.length; i++) {
      const add = g.heights[i] + (i > offset ? CARD_GAP : 0);
      if (i > offset && acc + add > g.bandHeight) break;
      acc += add; end = i + 1;
    }
    return Math.max(end, offset + 1);
  };

  // Smallest offset whose window still reaches the last card (→ no blank tail).
  const maxOffsetOf = (g: GroupState): number => {
    const n = g.pairs.length;
    if (n === 0) return 0;
    let acc = 0, off = n - 1;
    for (let i = n - 1; i >= 0; i--) {
      const add = g.heights[i] + (i < n - 1 ? CARD_GAP : 0);
      if (i < n - 1 && acc + add > g.bandHeight) break;
      acc += add; off = i;
    }
    return off;
  };

  const drawGroupLines = (g: GroupState, m = metrics()): void => {
    for (const p of g.pairs) removeLines(p.id);
    for (let i = g.offset; i < g.visEnd; i++) {
      const p = g.pairs[i];
      drawLine(p, m.aRect, m.proseRight, p.card.classList.contains("comment-card--active"));
    }
  };

  const setAccent = (btn: HTMLButtonElement, count: number, arrow: string): void => {
    if (count > 0) { btn.textContent = `${arrow} ${count}`; btn.hidden = false; }
    else btn.hidden = true;
  };

  const applyWindow = (g: GroupState, m = metrics()): void => {
    g.offset = clamp(g.offset, 0, maxOffsetOf(g));
    g.visEnd = computeVisEnd(g, g.offset);
    // Translate the first visible card to the clip top and size the box to exactly
    // the visible window. Use real layout positions (offsetTop/offsetHeight — which
    // are transform-independent and mutually consistent) rather than summing rounded
    // offsetHeights, whose downward drift would clip the last card's bottom border.
    // The +1 keeps that sub-pixel border inside the clip. Sizing the box to the
    // window also means "visible" and "has a connecting line" are the same set.
    const first = g.pairs[g.offset].card;
    const last = g.pairs[g.visEnd - 1].card;
    const firstTop = first.offsetTop;
    g.stack.style.transform = `translateY(${-firstTop}px)`;
    g.group.style.height = `${last.offsetTop + last.offsetHeight - firstTop + 1}px`;
    setAccent(g.up, g.offset, "↑");
    setAccent(g.down, g.pairs.length - g.visEnd, "↓");
    drawGroupLines(g, m);
  };

  const step = (g: GroupState, d: number): void => {
    const next = clamp(g.offset + d, 0, maxOffsetOf(g));
    if (next === g.offset) return;
    g.offset = next;
    applyWindow(g);
  };

  const onWheel = (e: WheelEvent, g: GroupState): void => {
    if (!inMargin()) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    const canStep = dir > 0 ? g.pairs.length - g.visEnd > 0 : g.offset > 0;
    if (!canStep) return; // bottomed/topped out → let the page scroll (containment)
    e.preventDefault();
    if (g.accum !== 0 && Math.sign(g.accum) !== Math.sign(e.deltaY)) g.accum = 0;
    g.accum += e.deltaY;
    while (Math.abs(g.accum) >= WHEEL_NOTCH) {
      const sd = g.accum > 0 ? 1 : -1;
      const before = g.offset;
      step(g, sd);
      g.accum -= sd * WHEEL_NOTCH;
      if (g.offset === before) { g.accum = 0; break; }
    }
  };

  // ---- jump-to-card (click a phrase whose card is scrolled out) -----------
  const flashCard = (card: HTMLElement): void => {
    card.classList.add("comment-card--flash");
    setTimeout(() => card.classList.remove("comment-card--flash"), 1200);
  };

  const jumpToCard = (p: Pair): void => {
    const g = groupOf(p);
    if (!g) return;
    const i = g.pairs.indexOf(p);
    if (!isVisible(g, i)) {
      let target: number;
      if (i < g.offset) {
        target = i - JUMP_CONTEXT;
      } else {
        // walk back from i, filling the band, so i lands near the bottom
        let acc = g.heights[i], off = i;
        for (let k = i - 1; k >= 0; k--) {
          const add = g.heights[k] + CARD_GAP;
          if (acc + add > g.bandHeight) break;
          acc += add; off = k;
        }
        target = off - JUMP_CONTEXT;
      }
      g.offset = clamp(target, 0, maxOffsetOf(g));
    }
    setActive(p, true);
    applyWindow(g);
    if (!isVisible(g, i)) { g.offset = clamp(i, 0, maxOffsetOf(g)); applyWindow(g); } // tall-card fallback
    flashCard(p.card);
    setTimeout(() => setActive(p, false), 1200);
  };

  // ---- layout -------------------------------------------------------------
  const layoutMargin = (): void => {
    article.classList.remove("comments-mobile");
    const m = metrics();
    svg.setAttribute("width", String(article.clientWidth));
    svg.setAttribute("height", String(article.clientHeight));
    while (svg.firstChild) svg.firstChild.remove();

    const tops = groups.map((g) => blockOf(g.pairs[0].anchor)!.getBoundingClientRect().top - m.aRect.top);
    for (const [gi, g] of groups.entries()) {
      const bandTop = tops[gi];
      const bandBottom = (gi + 1 < groups.length ? tops[gi + 1] : article.clientHeight) - CARD_GAP;
      g.bandHeight = Math.max(0, bandBottom - bandTop); // the fit budget (how many cards)
      g.group.style.top = `${Math.round(bandTop)}px`;
      g.heights = g.pairs.map((p) => p.card.offsetHeight);
      applyWindow(g, m); // sets the box height to the visible content; redraws lines
    }
  };

  // ---- mobile (tap to reveal inline) --------------------------------------
  const reveals = new WeakMap<HTMLElement, HTMLElement>();
  const layoutMobile = (): void => {
    article.classList.add("comments-mobile");
    while (svg.firstChild) svg.firstChild.remove();
  };
  for (const p of pairs) {
    const inlineReveal = (): void => {
      const block = blockOf(p.anchor);
      if (!block) return;
      const open = p.anchor.getAttribute("aria-expanded") === "true";
      reveals.get(p.anchor)?.remove();
      p.anchor.setAttribute("aria-expanded", open ? "false" : "true");
      if (open) return;
      const wrap = div("comment-reveal");
      wrap.append(cloneCardBody(p.card));
      block.after(wrap);
      reveals.set(p.anchor, wrap);
    };
    const onActivate = (e?: Event): void => {
      if (inMargin()) {
        // Margin mode: click the phrase to jump its box to the card. Don't fire
        // mid-selection (so selecting the highlighted text still works).
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return;
        e?.preventDefault();
        jumpToCard(p);
      } else {
        inlineReveal();
      }
    };
    p.anchor.addEventListener("click", onActivate);
    p.anchor.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivate(); }
    });
  }

  // ---- reciprocal hover (visible cards only — no overlay) -----------------
  for (const p of pairs) {
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    const enter = (): void => {
      if (!inMargin()) return;
      clearTimeout(leaveTimer);
      const g = groupOf(p);
      if (g && isVisible(g, g.pairs.indexOf(p))) setActive(p, true);
    };
    const leave = (): void => {
      if (!inMargin()) return;
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => setActive(p, false), 90);
    };
    p.anchor.addEventListener("mouseenter", enter);
    p.anchor.addEventListener("mouseleave", leave);
    p.anchor.addEventListener("focusin", enter);
    p.anchor.addEventListener("focusout", leave);
    p.card.addEventListener("mouseenter", enter);
    p.card.addEventListener("mouseleave", leave);
    p.card.querySelector<HTMLAnchorElement>(".comment-backref")?.addEventListener("click", (e) => {
      e.preventDefault();
      p.anchor.scrollIntoView({ block: "center", behavior: "smooth" });
      p.anchor.classList.add("comment-anchor--flash");
      setTimeout(() => p.anchor.classList.remove("comment-anchor--flash"), 1200);
    });
  }

  const mq = window.matchMedia(RAIL_MQ);
  // `hidden` is the user's "fold the rail into manual tap-to-reveal" preference
  // (persisted). When set, we drive the mobile (inline-reveal) layout even on a
  // wide screen — so `inMargin()`, not `mq.matches`, gates all rail behaviour.
  let hidden = false;
  try { hidden = localStorage.getItem(HIDE_KEY) === "true"; } catch { /* storage may be unavailable */ }
  const inMargin = (): boolean => mq.matches && !hidden;

  const layout = (): void => { if (inMargin()) layoutMargin(); else layoutMobile(); };

  // Hide-comments toggle (the eye button next to the theme switch).
  const toggleBtn = document.getElementById("comments-toggle");
  if (toggleBtn) {
    const syncBtn = (): void => {
      toggleBtn.setAttribute("aria-pressed", hidden ? "true" : "false");
      const label = hidden ? "Show margin comments" : "Hide margin comments";
      toggleBtn.setAttribute("aria-label", label);
      toggleBtn.setAttribute("title", label);
    };
    syncBtn();
    toggleBtn.addEventListener("click", () => {
      hidden = !hidden;
      try { localStorage.setItem(HIDE_KEY, hidden ? "true" : "false"); } catch { /* ignore */ }
      syncBtn();
      layout();
    });
  }

  layout();
  mq.addEventListener("change", layout);
  window.addEventListener("resize", debounce(layout, 120));
  new ResizeObserver(debounce(layout, 120)).observe(article);
  document.getElementById("theme-toggle")?.addEventListener("click", () => requestAnimationFrame(layout));
};

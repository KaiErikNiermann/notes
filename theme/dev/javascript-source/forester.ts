import "ninja-keys";
import "katex";
import { initMarginComments } from "./margin-comments";

import autoRenderMath from "katex/contrib/auto-render";
import hljs from "highlight.js/lib/core";
import type { LanguageFn } from "highlight.js";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import lean from "../../../highlight/lean";
import normalizeCodeNode from "./code-whitespace";

type Theme = "light" | "dark";
type LanguageRegistration = [string, LanguageFn];

interface ForestEntry {
  title: string | null;
  uri: string;
  taxon: string | null;
  tags?: string[] | null;
  route: string;
}

interface NinjaActionItem {
  id: string;
  title: string;
  section: string;
  hotkey?: string;
  icon?: string;
  handler: () => void;
}

// The <ninja-keys> custom element (from the "ninja-keys" package); we only assign
// its `data`. Plus the source-path the page shell injects on `window` for the
// "open in editor" command palette action.
interface NinjaKeysElement extends HTMLElement {
  data: NinjaActionItem[];
}
declare global {
  interface Window {
    sourcePath?: string;
  }
}

const REGISTERED_LANGS: LanguageRegistration[] = [
  ["lean", lean],
  ["javascript", javascript],
  ["js", javascript],
  ["typescript", typescript],
  ["ts", typescript],
  ["python", python],
  ["py", python],
  ["bash", bash],
  ["sh", bash],
  ["json", json],
  ["xml", xml],
  ["html", xml],
];

for (const [name, lang] of REGISTERED_LANGS) {
  try {
    hljs.registerLanguage(name, lang);
  } catch (error) {
    console.warn("Failed to register language", name, error);
  }
}

// Lucide icons (https://lucide.dev) — official SVG output, not handrolled.
const COPY_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const CHECK_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check"><path d="M20 6 9 17l-5-5"/></svg>';
const EXPAND_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-maximize-2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>';
const COPY_PLUS_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy-plus"><line x1="15" x2="15" y1="12" y2="18"/><line x1="12" x2="18" y1="15" y2="15"/><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const CLOSE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
type Segment =
  | { kind: "kept"; text: string }
  | { kind: "stub"; leader: string; summary: string };

// Matches a line containing the literal `forester-ignore: start|end` with an optional
// `(summary)` payload. Captures the comment leader (whatever appears before the keyword
// on the line) so the rendered stub mirrors the source's comment syntax.
const MARKER_RE = /^(.*?)forester-ignore:\s*(start|end)(?:\s*\(([^)]*)\))?\s*$/;

const parseIgnoreMarkers = (source: string): Segment[] | null => {
  const lines = source.split("\n");
  const segments: Segment[] = [];
  let keptBuf: string[] = [];
  let inIgnore = false;
  let currentLeader = "//";
  let currentSummary = "";

  const flushKept = (): void => {
    if (keptBuf.length > 0) {
      segments.push({ kind: "kept", text: keptBuf.join("\n") });
      keptBuf = [];
    }
  };

  for (const line of lines) {
    const m = MARKER_RE.exec(line);
    if (!m) {
      if (!inIgnore) keptBuf.push(line);
      continue;
    }
    const [, prefixRaw, kind, summary] = m;
    if (kind === "start") {
      if (inIgnore) return null; // nested start — treat as malformed
      flushKept();
      inIgnore = true;
      currentLeader = (prefixRaw ?? "").replace(/\s+$/, "") || "//";
      currentSummary = (summary ?? "").trim();
    } else {
      if (!inIgnore) return null; // end without start — malformed
      segments.push({ kind: "stub", leader: currentLeader, summary: currentSummary });
      inIgnore = false;
    }
  }

  if (inIgnore) return null; // unterminated start
  flushKept();
  return segments;
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const detectLanguage = (codeEl: HTMLElement, preEl: HTMLElement): string | null => {
  const fromClass = (el: HTMLElement): string | null => {
    for (const cls of el.classList) {
      if (cls.startsWith("language-")) return cls.slice("language-".length);
    }
    return null;
  };
  return fromClass(codeEl) ?? fromClass(preEl);
};

const highlightSegment = (text: string, language: string | null): string => {
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } catch (error) {
      console.warn("Highlight error", error);
    }
  }
  return escapeHtml(text);
};

const copyToClipboard = async (
  text: string,
  btn: HTMLButtonElement,
  originalIcon: string,
): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    console.warn("Copy failed", error);
    return;
  }
  btn.innerHTML = CHECK_ICON_SVG;
  btn.classList.add("copied");
  const prev = (btn as { _resetTimer?: ReturnType<typeof setTimeout> })._resetTimer;
  if (prev) clearTimeout(prev);
  (btn as { _resetTimer?: ReturnType<typeof setTimeout> })._resetTimer = setTimeout(() => {
    btn.innerHTML = originalIcon;
    btn.classList.remove("copied");
  }, 1500);
};

const makeIconButton = (
  iconSvg: string,
  label: string,
  className: string,
  onClick: (btn: HTMLButtonElement) => void,
): HTMLButtonElement => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.innerHTML = iconSvg;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick(btn);
  });
  return btn;
};

// ---------------------------------------------------------------------------
// Modal for expanded code view
// ---------------------------------------------------------------------------

interface ModalRefs {
  root: HTMLDivElement;
  panel: HTMLDivElement;
  pre: HTMLPreElement;
  code: HTMLElement;
  langLabel: HTMLSpanElement;
  copyBtn: HTMLButtonElement;
}

let modalRefs: ModalRefs | null = null;
let lastFocused: HTMLElement | null = null;

const renderLineNumbers = (highlightedHtml: string): string => {
  // Split the highlighted HTML on newlines and wrap each line in a .code-line span.
  // hljs's emitted spans never straddle newlines, so a literal "\n" split is safe.
  const trimmed = highlightedHtml.replace(/\n$/, "");
  return trimmed
    .split("\n")
    .map((line) => `<span class="code-line">${line || " "}</span>`)
    .join("");
};

const ensureModal = (): ModalRefs => {
  if (modalRefs) return modalRefs;

  const root = document.createElement("div");
  root.className = "code-modal";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.hidden = true;

  const backdrop = document.createElement("div");
  backdrop.className = "code-modal__backdrop";

  const panel = document.createElement("div");
  panel.className = "code-modal__panel";

  const bar = document.createElement("header");
  bar.className = "code-modal__bar";

  const langLabel = document.createElement("span");
  langLabel.className = "code-modal__lang";

  const copyBtn = makeIconButton(
    COPY_ICON_SVG,
    "Copy code",
    "code-copy-btn code-modal__copy",
    (btn) => {
      const text = modalRefs?.code.textContent ?? "";
      void copyToClipboard(text.replace(/\n$/, ""), btn, COPY_ICON_SVG);
    },
  );

  const closeBtn = makeIconButton(CLOSE_ICON_SVG, "Close", "code-copy-btn code-modal__close", () => {
    closeModal();
  });

  bar.append(langLabel, copyBtn, closeBtn);

  const pre = document.createElement("pre");
  pre.className = "code-block code-modal__pre";
  const code = document.createElement("code");
  pre.append(code);

  panel.append(bar, pre);
  root.append(backdrop, panel);
  document.body.append(root);

  backdrop.addEventListener("click", () => closeModal());
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  modalRefs = { root, panel, pre, code, langLabel, copyBtn };
  return modalRefs;
};

const openCodeModal = (language: string | null, fullSource: string, opener: HTMLElement): void => {
  const refs = ensureModal();
  const lang = language ?? "text";
  refs.langLabel.textContent = lang;
  refs.pre.className = `code-block code-modal__pre language-${lang}`;
  refs.code.className = `language-${lang}`;
  refs.code.innerHTML = renderLineNumbers(highlightSegment(fullSource, language));
  refs.root.hidden = false;
  document.documentElement.classList.add("code-modal-open");
  lastFocused = opener;
  // Defer focus to next tick so the dialog is actually rendered.
  setTimeout(() => refs.root.focus(), 0);
  refs.root.tabIndex = -1;
};

const closeModal = (): void => {
  if (!modalRefs) return;
  modalRefs.root.hidden = true;
  document.documentElement.classList.remove("code-modal-open");
  if (lastFocused) {
    lastFocused.focus();
    lastFocused = null;
  }
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalRefs && !modalRefs.root.hidden) closeModal();
});

// ---------------------------------------------------------------------------
// Code-block orchestration
// ---------------------------------------------------------------------------

const buildToolbar = (
  pre: HTMLPreElement,
  visibleText: string,
  fullSource: string | null,
  language: string | null,
): void => {
  if (pre.querySelector(":scope > .code-toolbar")) return;

  const toolbar = document.createElement("div");
  toolbar.className = "code-toolbar";

  const copyVisible = makeIconButton(
    COPY_ICON_SVG,
    fullSource ? "Copy visible code" : "Copy code",
    "code-copy-btn",
    (btn) => void copyToClipboard(visibleText.replace(/\n$/, ""), btn, COPY_ICON_SVG),
  );

  if (fullSource) {
    const copyFull = makeIconButton(
      COPY_PLUS_ICON_SVG,
      "Copy full code (including hidden sections)",
      "code-copy-btn",
      (btn) => void copyToClipboard(fullSource.replace(/\n$/, ""), btn, COPY_PLUS_ICON_SVG),
    );

    const expand = makeIconButton(EXPAND_ICON_SVG, "Show full code", "code-copy-btn", () => {
      openCodeModal(language, fullSource, expand);
    });

    toolbar.append(expand, copyFull, copyVisible);
  } else {
    toolbar.append(copyVisible);
  }

  pre.append(toolbar);
};

const processCodeBlock = (pre: HTMLPreElement): void => {
  const code = pre.querySelector<HTMLElement>("code");
  if (!code) return;
  if (code.dataset.highlighted === "true") return;

  normalizeCodeNode(code);

  const language = detectLanguage(code, pre);
  const source = code.textContent ?? "";

  const segments = parseIgnoreMarkers(source);

  if (segments && segments.some((s) => s.kind === "stub")) {
    // Expandable path: render kept segments highlighted, stubs as muted spans.
    const parts: string[] = [];
    for (const segment of segments) {
      const seg = segment;
      if (seg.kind === "kept") {
        parts.push(highlightSegment(seg.text, language));
      } else {
        const text = seg.summary ? `${seg.leader} ${seg.summary}` : `${seg.leader} ...`;
        parts.push(`<span class="code-stub">${escapeHtml(text)}</span>`);
      }
    }
    code.innerHTML = parts.join("\n");
    code.dataset.highlighted = "true";
    pre.dataset.fullSource = source;
    const visible = segments
      .map((s) => (s.kind === "kept" ? s.text : (s.summary ? `${s.leader} ${s.summary}` : `${s.leader} ...`)))
      .join("\n");
    buildToolbar(pre, visible, source, language);
    return;
  }

  // Plain path: behave like before.
  try {
    if (language && hljs.getLanguage(language)) {
      hljs.highlightElement(code);
    }
    code.dataset.highlighted = "true";
  } catch (error) {
    console.warn("Highlight error", error);
  }
  buildToolbar(pre, source, null, language);
};

const processAllCodeBlocks = (): void => {
  for (const pre of document.querySelectorAll<HTMLPreElement>("pre.code-block")) processCodeBlock(pre);
  // Fallback: any pre>code without .code-block (rare) still gets plain highlighting.
  for (const block of document.querySelectorAll<HTMLElement>("pre:not(.code-block) code")) {
    if (block.dataset.highlighted === "true") continue;
    normalizeCodeNode(block);
    try {
      hljs.highlightElement(block);
      block.dataset.highlighted = "true";
    } catch (error) {
      console.warn("Highlight error", error);
    }
  }
};

const partition = <T,>(array: T[], predicate: (item: T) => boolean): [T[], T[]] => {
  return array.reduce<[T[], T[]]>(
    ([pass, fail], elem) => (predicate(elem) ? [[...pass, elem], fail] : [pass, [...fail, elem]]),
    [[], []]
  );
};

const THEME_KEY = "forester-theme" as const;

const getBaseUrl = (): string => {
  const base = document.documentElement?.dataset?.baseUrl ?? "/";
  return base.endsWith("/") ? base : `${base}/`;
};

const CONTAINER_ROOT = "/workspaces/uni/random/notes" as const;
const VSCODE_REMOTE_PREFIX =
  "vscode://vscode-remote/dev-container+2f776f726b7370616365732f756e692f72616e646f6d2f6e6f746573";

const getForestJsonUrl = (): string => `${getBaseUrl()}forest.json`;

const getEditorUri = (path?: string | null): string | null => {
  if (!path) {
    return null;
  }
  if (path.startsWith(CONTAINER_ROOT)) {
    return `${VSCODE_REMOTE_PREFIX}${path}`;
  }
  return `vscode://file${path}`;
};

const applyTheme = (theme: Theme): void => {
  // Carrier lives on <html> (:root) — matches the anti-FOUC <head> bootstrap and the
  // `:root[data-theme]` CSS. The toggle icon is CSS-driven off this same attribute,
  // and color-scheme keeps the UA canvas/scrollbars in sync with the theme.
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
  // ninja-keys ships a built-in dark palette gated behind a `dark` class; keep
  // it in sync with the site theme so the command palette isn't stuck light.
  document.querySelector("ninja-keys")?.classList.toggle("dark", theme === "dark");
};

const getStoredTheme = (): Theme | null => {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "dark" || stored === "light" ? stored : null;
  } catch {
    return null;
  }
};

const storeTheme = (theme: Theme): void => {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore storage failures
  }
};

/**
 * Auto-number citation links.
 * Finds all links with class "citation" or links pointing to Reference trees,
 * and numbers them sequentially [1], [2], etc. Each unique reference gets
 * the same number throughout the document.
 */
const numberCitations = (): void => {
  const citationMap = new Map<string, number>();
  let counter = 1;

  // Find all citation links - either explicitly marked with .citation class
  // or links whose title contains "Reference" (indicating a reference tree)
  const citationLinks = document.querySelectorAll<HTMLAnchorElement>(
    'a.citation, span.link.local a[title*="Reference"], span.citation a'
  );

  for (const link of citationLinks) {
    const href = link.getAttribute("href");
    if (!href) continue;

    // Use the href as the unique key for the reference
    const refKey = href.replace(/#.*$/, ""); // Strip any anchor

    if (!citationMap.has(refKey)) {
      citationMap.set(refKey, counter++);
    }

    const citationNumber = citationMap.get(refKey)!;
    // Only replace if the link text looks like it's meant to be a citation
    // (contains brackets or is just a number)
    const currentText = link.textContent?.trim() || "";
    if (
      currentText.startsWith("[") ||
      /^\d+$/.test(currentText) ||
      /^\[\d+\]$/.test(currentText) ||
      link.closest(".citation")
    ) {
      link.textContent = `[${citationNumber}]`;
    }
  }
};

/**
 * Hydrate \symref preview popovers with the body of their matching \symdef.
 * Each \symref renders as <span class="symref"><a data-sym="id">name</a>
 * <span class="symref-preview"></span></span>; the matching \symdef anchor
 * has id="sym-{id}". Same-tree lookup only — cross-tree would need a registry.
 *
 * Also installs a viewport-clamping positioner so previews never extend past
 * the page edges (their default centered position can otherwise overflow).
 */
/**
 * Place the (position: fixed) preview centered below the trigger, clamped so
 * it stays fully inside the viewport. If there isn't room below, flip above.
 */
const positionPreview = (symref: HTMLElement): void => {
  const preview = symref.querySelector<HTMLElement>(":scope > .symref-preview");
  if (!preview) return;

  const trigger = symref.getBoundingClientRect();
  const previewWidth = preview.offsetWidth;
  const previewHeight = preview.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const margin = 12;
  const gap = 6;

  // Horizontal: center on trigger, then clamp to viewport.
  const desiredLeft = trigger.left + trigger.width / 2 - previewWidth / 2;
  const left = Math.max(margin, Math.min(desiredLeft, vw - previewWidth - margin));

  // Vertical: prefer below; flip above if not enough room.
  const spaceBelow = vh - trigger.bottom;
  const spaceAbove = trigger.top;
  const top =
    spaceBelow >= previewHeight + gap + margin || spaceBelow >= spaceAbove
      ? trigger.bottom + gap
      : Math.max(margin, trigger.top - previewHeight - gap);

  preview.style.left = `${left}px`;
  preview.style.top = `${top}px`;
};

const hydrateSymrefs = (): void => {
  const symrefs = document.querySelectorAll<HTMLElement>(".symref");
  for (const symref of symrefs) {
    const preview = symref.querySelector<HTMLElement>(":scope > .symref-preview");
    if (!preview || preview.dataset.hydrated === "true") continue;
    const link = symref.querySelector<HTMLElement>("a[data-sym]");
    const id = link?.dataset.sym;
    if (!id) continue;
    const def = document.getElementById(`sym-${id}`);
    if (def) {
      preview.innerHTML = def.innerHTML;
    } else {
      preview.classList.add("symref-preview--missing");
      preview.textContent = `unresolved: ${id}`;
    }
    preview.dataset.hydrated = "true";

    const reposition = (): void => positionPreview(symref);
    symref.addEventListener("mouseenter", reposition);
    symref.addEventListener("focusin", reposition);
  }
};

/**
 * d3 figures are bundled into output/notes/d3-assets/figures.js (the d3-figures
 * build stage). That bundle is heavy (d3 ≈ 90 KB gzip), so only fetch it on
 * pages that actually contain a figure. The bundle auto-mounts on import.
 */
const initD3Figures = (): void => {
  if (!document.querySelector("[data-d3], [data-d3-inline]")) {
    return;
  }
  // Built at runtime so esbuild treats it as an external dynamic import rather
  // than trying to resolve/bundle it at build time.
  const bundleUrl = `${getBaseUrl()}d3-assets/figures.js`;
  import(bundleUrl).catch((error) => console.error("Failed to load d3 figures bundle", error));
};

window.addEventListener("load", () => {
  processAllCodeBlocks();
  hydrateSymrefs();
  initD3Figures();
  initMarginComments();
  autoRenderMath(document.body, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: String.raw`\(`, right: String.raw`\)`, display: false },
      { left: String.raw`\[`, right: String.raw`\]`, display: true },
    ],
    ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
    macros: {
      "\\cf": String.raw`\texttt{#1}`,
      "\\mc": String.raw`\mathcal{#1}`,
    },
  });

  // Number citations after math rendering
  numberCitations();

  const themeToggle = document.getElementById("theme-toggle");
  let prefersDark: MediaQueryList | null;
  try {
    prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    prefersDark = null;
  }

  const storedTheme = getStoredTheme();
  const systemTheme: Theme = prefersDark && prefersDark.matches ? "dark" : "light";
  // Explicit choice wins; otherwise follow the OS. (Mirrors the <head> bootstrap.)
  const initialTheme: Theme = storedTheme ?? systemTheme;
  applyTheme(initialTheme);

  if (themeToggle instanceof HTMLElement) {
    themeToggle.addEventListener("click", () => {
      const nextTheme: Theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(nextTheme);
      storeTheme(nextTheme);
    });
  }

  const onSchemeChange = (evt: MediaQueryListEvent): void => {
    if (!getStoredTheme()) applyTheme(evt.matches ? "dark" : "light");
  };
  if (prefersDark?.addEventListener) {
    prefersDark.addEventListener("change", onSchemeChange);
  } else {
    // eslint-disable-next-line sonarjs/deprecation -- legacy Safari <14 fallback: matchMedia only had addListener
    prefersDark?.addListener?.(onSchemeChange);
  }

  const openAllDetailsAbove = (element: Element | null): void => {
    let cursor: Element | null = element;
    while (cursor) {
      if (cursor instanceof HTMLDetailsElement) {
        cursor.open = true;
      }
      cursor = cursor.parentElement;
    }
  };

  const jumpToSubtree = (evt: MouseEvent): void => {
    const target = evt.target;
    if (!(target instanceof HTMLElement) || target.tagName === "A") {
      return;
    }

    const link = target.closest<HTMLElement>("span[data-target]");
    if (!link) {
      return;
    }
    const selector = link.dataset.target;
    if (!selector) {
      return;
    }
    const tree = document.querySelector<HTMLElement>(selector);
    if (!tree) {
      return;
    }

    openAllDetailsAbove(tree);
    window.location.assign(selector);
  };

  for (const el of document
    .querySelectorAll<HTMLElement>("[data-target^='#']")) el.addEventListener("click", jumpToSubtree);

  initializeNinjaKeys();
});

const initializeNinjaKeys = (): void => {
  const ninja = document.querySelector<NinjaKeysElement>("ninja-keys");
  if (!ninja) {
    console.warn("ninja-keys element not found; search is disabled");
    return;
  }

  fetch(getForestJsonUrl())
    .then((res) => {
      if (!res.ok) {
        throw new Error(`Failed to load forest.json (${res.status})`);
      }
      return res.json() as Promise<ForestEntry[]>;
    })
    .then((entries) => {
      const items: NinjaActionItem[] = [];

      const editIcon =
        '<svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20"><path d="M480-120v-71l216-216 71 71-216 216h-71ZM120-330v-60h300v60H120Zm690-49-71-71 29-29q8-8 21-8t21 8l29 29q8 8 8 21t-8 21l-29 29ZM120-495v-60h470v60H120Zm0-165v-60h470v60H120Z"/></svg>';
      const bookmarkIcon =
        '<svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20"><path d="M120-40v-700q0-24 18-42t42-18h480q24 0 42.5 18t18.5 42v700L420-167 120-40Zm60-91 240-103 240 103v-609H180v609Zm600 1v-730H233v-60h547q24 0 42 18t18 42v730h-60ZM180-740h480-480Z"/></svg>';

      const editUri = getEditorUri(window.sourcePath);
      if (editUri) {
        items.push({
          id: "edit",
          title: "Edit current tree in Visual Studio Code",
          section: "Commands",
          hotkey: "cmd+e",
          icon: editIcon,
          handler: () => {
            window.location.href = editUri;
          },
        });
      }

      const isTopTree = (entry: ForestEntry): boolean => entry.tags?.includes("top") ?? false;

      const addItemToSection = (entry: ForestEntry, section: string, icon?: string): void => {
        const title = entry.taxon
          ? (entry.title
            ? `${entry.taxon}. ${entry.title}`
            : entry.taxon)
          : entry.title ?? "Untitled";
        const fullTitle = `${title} [${entry.uri}]`;
        items.push({
          id: entry.uri,
          title: fullTitle,
          section,
          ...(icon ? { icon } : {}),
          handler: () => {
            window.location.href = entry.route;
          },
        });
      };

      const [topEntries, restEntries] = partition(entries, isTopTree);
      for (const entry of topEntries) addItemToSection(entry, "Top Trees", bookmarkIcon);
      for (const entry of restEntries) addItemToSection(entry, "All Trees");

      ninja.data = items;
    })
    .catch((error) => {
      console.error("Failed to initialize ninja-keys data", error);
    });
};

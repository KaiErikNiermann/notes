/**
 * shell.ts — the static page chrome from tree.xsl (the `<head>` link/script
 * block, the page-control buttons (dark-mode + hide-comments), and the Home
 * header). All inline SVG icons live in `icons.ts` (one monochrome family).
 */
import { h } from "hastscript";
import type { Element } from "hast";
import { SUN_ICON, MOON_ICON, SHARE_ICON, EYE_ICON, EYE_OFF_ICON } from "./icons";

const stylesheet = (href: string): Element => h("link", { rel: "stylesheet", href });
const script = (src: string, attrs: Record<string, unknown> = {}): Element => h("script", { ...attrs, src });

// Theme is resolved synchronously in a blocking <head> script — BEFORE the body is
// parsed or painted — so the very first frame already has the right theme (no FOUC,
// in any browser). It writes the carrier onto <html> (:root), which is the only
// element that exists this early; all theme CSS is keyed on `:root[data-theme]`.
// An explicit stored choice wins; otherwise the OS preference is honoured. It also
// sets `color-scheme` on the root so the UA canvas/scrollbars match from frame one
// (else Firefox paints its dark-mode default canvas through the bg-less <html> — a
// gray flash). Keyed string mirrors THEME_KEY in forester.ts ("forester-theme").
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("forester-theme");var k=(t==="light"||t==="dark")?t:((window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light");var e=document.documentElement;e.setAttribute("data-theme",k);e.style.colorScheme=k;}catch(_){}})();`;

/** Inline blocking <head> script that sets the theme on :root before first paint (anti-FOUC). */
export const themeBootstrap = (): Element => h("script", [{ type: "text", value: THEME_BOOTSTRAP }]);

export const renderHead = (baseUrl: string, titleText: string, sourcePath?: string): Element =>
  h("head", [
    // libxslt (method="html") auto-inserts this charset meta as the first child.
    h("meta", { charset: "utf-8" }),
    // Set the theme on :root before anything paints (see THEME_BOOTSTRAP).
    themeBootstrap(),
    h("meta", { name: "viewport", content: "width=device-width" }),
    h("link", { rel: "icon", type: "image/svg+xml", href: `${baseUrl}notes-icon.svg` }),
    stylesheet(`${baseUrl}katex.min.css`),
    stylesheet(`${baseUrl}verso-assets/verso-vars.css`),
    stylesheet(`${baseUrl}verso-assets/verso-snippet.css`),
    stylesheet(`${baseUrl}verso-assets/-verso-data/tippy-border.css`),
    stylesheet(`${baseUrl}style.css`),
    script(`${baseUrl}verso-assets/-verso-data/popper.min.js`),
    script(`${baseUrl}verso-assets/-verso-data/tippy-bundle.umd.min.js`),
    script(`${baseUrl}verso-assets/marked.min.js`),
    script(`${baseUrl}verso-assets/verso-snippet-init.js`, { defer: true }),
    h("script", { type: "text/javascript" }, sourcePath ? [{ type: "text", value: `window.sourcePath = '${sourcePath}'` }] : []),
    h("script", { type: "module", src: `${baseUrl}forester.js` }),
    h("title", [{ type: "text", value: titleText }]),
  ]);

// Both glyphs are rendered; CSS shows the one for the theme you'd switch TO, keyed
// on the :root[data-theme] carrier — so the correct icon is right at first paint.
const themeToggle = (): Element =>
  h("button", { id: "theme-toggle", class: "page-control theme-toggle", type: "button", "aria-label": "Toggle color theme" }, [
    h("span", { class: "page-control__icon page-control__icon--sun", "aria-hidden": "true" }, [SUN_ICON]),
    h("span", { class: "page-control__icon page-control__icon--moon", "aria-hidden": "true" }, [MOON_ICON]),
  ]);

// Hide-comments toggle: flips margin comments into manual tap-to-reveal. Carries
// both eye states; CSS shows one based on aria-pressed, JS (margin-comments.ts)
// flips the state. Hidden by CSS unless the page actually has margin comments.
const commentsToggle = (): Element =>
  h(
    "button",
    { id: "comments-toggle", class: "page-control comments-toggle", type: "button", "aria-pressed": "false", "aria-label": "Hide margin comments", title: "Hide margin comments" },
    [
      h("span", { class: "page-control__icon page-control__icon--on", "aria-hidden": "true" }, [EYE_ICON]),
      h("span", { class: "page-control__icon page-control__icon--off", "aria-hidden": "true" }, [EYE_OFF_ICON]),
    ],
  );

/** The fixed top-right cluster of page-chrome buttons (theme + hide-comments). */
export const pageControls = (): Element =>
  h("div", { class: "page-controls" }, [commentsToggle(), themeToggle()]);

export const homeHeader = (baseUrl: string): Element =>
  h("header", { class: "header" }, [
    h("nav", { class: "nav" }, [
      h("div", { class: "logo" }, [h("a", { href: `${baseUrl}index/`, title: "Home" }, [{ type: "text", value: "« Home" }])]),
    ]),
  ]);

export const shareButton = (baseUrl: string, displayUri: string): Element =>
  h(
    "a",
    {
      class: "graph-button",
      href: `${baseUrl}graph/?focus=${displayUri}`,
      title: "Open this note in the graph view",
      "aria-label": "Open this note in the graph view",
    },
    [SHARE_ICON],
  );


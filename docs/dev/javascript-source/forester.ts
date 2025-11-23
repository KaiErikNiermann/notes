import "ninja-keys";
import "katex";

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

REGISTERED_LANGS.forEach(([name, lang]) => {
  try {
    hljs.registerLanguage(name, lang);
  } catch (err) {
    console.warn("Failed to register language", name, err);
  }
});

const highlightCodeBlocks = (): void => {
  document.querySelectorAll<HTMLElement>("pre code").forEach((block) => {
    if (block.dataset.highlighted === "true") {
      return;
    }
    normalizeCodeNode(block);
    try {
      hljs.highlightElement(block);
      block.dataset.highlighted = "true";
    } catch (err) {
      console.warn("Highlight error", err);
    }
  });
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
  document.body?.setAttribute("data-theme", theme);
  const icon = document.querySelector<HTMLElement>("#theme-toggle .theme-toggle__icon");
  if (icon) {
    icon.textContent = theme === "dark" ? "☀︎" : "☾";
  }
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

window.addEventListener("load", () => {
  highlightCodeBlocks();
  autoRenderMath(document.body, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\(", right: "\\)", display: false },
      { left: "\\[", right: "\\]", display: true },
    ],
    ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
  });

  const themeToggle = document.getElementById("theme-toggle");
  let prefersDark: MediaQueryList | null;
  try {
    prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    prefersDark = null;
  }

  const storedTheme = getStoredTheme();
  const fallbackTheme: Theme = "dark";
  const systemTheme: Theme = prefersDark && prefersDark.matches ? "dark" : "light";
  const initialTheme: Theme = storedTheme ?? fallbackTheme ?? systemTheme;
  applyTheme(initialTheme);

  if (themeToggle instanceof HTMLElement) {
    themeToggle.addEventListener("click", () => {
      const nextTheme: Theme = document.body?.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(nextTheme);
      storeTheme(nextTheme);
    });
  }

  if (prefersDark?.addEventListener) {
    prefersDark.addEventListener("change", (evt) => {
      if (!getStoredTheme()) {
        applyTheme(evt.matches ? "dark" : "light");
      }
    });
  } else if (prefersDark?.addListener) {
    prefersDark.addListener((evt) => {
      if (!getStoredTheme()) {
        applyTheme(evt.matches ? "dark" : "light");
      }
    });
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
    const selector = link.getAttribute("data-target");
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

  document
    .querySelectorAll<HTMLElement>("[data-target^='#']")
    .forEach((el) => el.addEventListener("click", jumpToSubtree));

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
          ? entry.title
            ? `${entry.taxon}. ${entry.title}`
            : entry.taxon
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
      topEntries.forEach((entry) => addItemToSection(entry, "Top Trees", bookmarkIcon));
      restEntries.forEach((entry) => addItemToSection(entry, "All Trees"));

      ninja.data = items;
    })
    .catch((err) => {
      console.error("Failed to initialize ninja-keys data", err);
    });
};

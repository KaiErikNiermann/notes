/**
 * Entry-point script for /notes/graph/. Bundled by the `graph-page` stage
 * into `output/notes/graph/notes-theme-mount.js`.
 *
 * Responsibilities:
 *   - fetch graph data,
 *   - read `?focus=` from the URL,
 *   - build the notes-site Theme,
 *   - call `ForesterGraphView.mountGraph(...)`,
 *   - on theme toggle, call `handle.setTheme(...)`.
 */
import { buildNotesTheme, detectMode } from "./notes-theme";

declare global {
  interface Window {
    ForesterGraphView: {
      mountGraph: (opts: unknown) => {
        update: (data: unknown) => void;
        setTheme: (theme: unknown) => void;
        setFocus: (id: string | null) => void;
        destroy: () => void;
      };
    };
  }
}

const main = async (): Promise<void> => {
  const root = document.getElementById("graph-root");
  if (!root) throw new Error("graph-root container not found");

  const url = new URL(window.location.href);
  const focus = url.searchParams.get("focus") ?? undefined;

  const res = await fetch("data.json");
  if (!res.ok) throw new Error(`failed to load data.json: ${res.status}`);
  const data: unknown = await res.json();

  // Sync the page's body[data-theme] with the saved preference from the rest of the site.
  const stored = (() => {
    try {
      const s = localStorage.getItem("forester-theme");
      return s === "dark" || s === "light" ? s : null;
    } catch {
      return null;
    }
  })();
  document.body.setAttribute("data-theme", stored ?? "dark");

  const handle = window.ForesterGraphView.mountGraph({
    container: root,
    data,
    theme: buildNotesTheme(detectMode()),
    focus,
    onNodeClick: (node: { id: string }) => {
      window.location.href = `/notes/${node.id}/`;
    },
  });

  // Re-skin when the site's theme toggles. We listen on a `data-theme`
  // mutation rather than the toggle button so it works regardless of how
  // the theme is changed.
  const observer = new MutationObserver(() => {
    handle.setTheme(buildNotesTheme(detectMode()));
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
};

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  document.body.innerHTML += `<pre style="position:fixed;bottom:8px;left:16px;color:#f88">graph view error: ${message}</pre>`;
  // eslint-disable-next-line no-console
  console.error(err);
});

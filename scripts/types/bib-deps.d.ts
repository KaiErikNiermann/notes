// Ambient declarations for citation.js, which ships no TypeScript types. We
// declare only the slice of the API that scripts/bib-to-tree.ts actually uses.

declare module "@citation-js/core" {
  /** A CSL-JSON record. We only read it opaquely, so values stay `unknown`. */
  export type CslRecord = Readonly<Record<string, unknown>>;

  export class Cite {
    constructor(data?: unknown, options?: Readonly<Record<string, unknown>>);
    /** Resolves identifiers that require I/O (DOI, URL, Wikidata, …). */
    static async(data: unknown, options?: Readonly<Record<string, unknown>>): Promise<Cite>;
    readonly data: readonly CslRecord[];
    format(format: string, options?: Readonly<Record<string, unknown>>): string;
  }

  /**
   * A raw parsed (Bib)LaTeX entry — the `@…/entries+list` intermediate format,
   * before normalisation to CSL. Field names and values are preserved verbatim.
   */
  export interface BibtexEntry {
    readonly type: string;
    readonly label: string;
    // Values are usually strings, but citation.js parses bare numeric fields
    // (e.g. `year = 2025`) as numbers.
    readonly properties: Readonly<Record<string, string | number>>;
  }

  export interface ChainOptions {
    readonly generateGraph?: boolean;
    readonly target?: string;
  }

  export interface InputPlugin {
    /**
     * Typed for the `@…/entries+list` target this project requests; the real
     * method is polymorphic over the requested target format.
     */
    chain(data: string, options?: ChainOptions): readonly BibtexEntry[];
  }

  export const plugins: { readonly input: InputPlugin };
}

// Plugins register input/output formats on import; they expose no values we call.
declare module "@citation-js/plugin-doi";
declare module "@citation-js/plugin-bibtex";

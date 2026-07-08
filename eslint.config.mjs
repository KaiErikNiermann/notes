// Flat ESLint config — lints only the first-party TypeScript we own:
//   scripts/**            (the Node build pipeline)
//   theme/dev/javascript-source/**  (in-page browser modules)
//   server.ts             (the dev server)
// Generated output (output/, build/, theme/forester.js, .tmp), vendored code
// (lean/, highlight/, figures/), and plain JS/config files are NOT linted.
//
// Type-aware rules use `projectService`, which resolves each file to its own
// tsconfig automatically (root → scripts + server, scripts/dev → DOM, theme/dev
// → browser), so the Node/DOM split is handled without per-file project lists.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import security from "eslint-plugin-security";
import globals from "globals";

const OWNED = ["scripts/**/*.ts", "theme/dev/javascript-source/**/*.ts", "server.ts"];

export default tseslint.config(
  {
    ignores: [
      "output/**",
      "build/**",
      "node_modules/**",
      "**/.tmp/**",
      "**/*.d.ts",
      "lean/**",
      "highlight/**",
      "figures/**",
      // config + generated/vendored JS — we only lint our own TS
      "**/*.js",
      "**/*.cjs",
      "**/*.mjs",
    ],
  },
  {
    files: OWNED,
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      sonarjs.configs.recommended,
      unicorn.configs.recommended,
      security.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- noise suppression: rules that are predominantly false positives here ---
      "unicorn/prevent-abbreviations": "off", // flags ctx, args, props, el, fn, db, idx, …
      "unicorn/no-null": "off", // `null` is idiomatic against the DOM / JSON
      "security/detect-object-injection": "off", // fires on every `obj[key]` — pure noise
      "security/detect-non-literal-fs-filename": "off", // this is a build tool; dynamic fs paths are the point
      "unicorn/prefer-global-this": "off", // `window` reads clearer than `globalThis` in browser modules
      "unicorn/prefer-module": "off", // the build pipeline is CommonJS (require / __dirname)
      "unicorn/import-style": "off", // fights legitimate, readable import shapes
      "unicorn/text-encoding-identifier-case": "off", // 'utf-8' is the correct spelling in HTML charset metas
      "unicorn/prefer-query-selector": "off", // getElementById is fine and faster for ids
      "unicorn/no-await-expression-member": "off", // `(await x).y` is fine
      "unicorn/no-array-callback-reference": "off", // false-positives on point-free map/filter callbacks
      "unicorn/no-array-reduce": "off", // reduce is a legitimate tool
      "unicorn/consistent-function-scoping": "off", // closures are intentionally co-located inside init()
      "unicorn/no-process-exit": "off", // a CLI build tool legitimately calls process.exit
      "sonarjs/no-nested-functions": "off", // same closures-in-init organization
      "sonarjs/no-nested-conditional": "off", // the auto-fixable unicorn/no-nested-ternary already covers this
      "sonarjs/prefer-regexp-exec": "off", // String#match is fine for non-global patterns
      "sonarjs/no-nested-template-literals": "off", // nested templates stay readable here
      "sonarjs/no-hardcoded-ip": "off", // 127.0.0.1 is the intended dev-server bind address
      "sonarjs/todo-tag": "off", // TODO comments are allowed
      "unicorn/prefer-at": "off", // .at() returns T|undefined (fights strict TS) and DOM collections lack it
      "unicorn/prefer-string-replace-all": "off", // replaceAll is ES2021; the browser tsconfig targets ES2020
      "unicorn/prefer-top-level-await": "off", // the CLI entry's .then/.catch is explicit and fine
      "unicorn/prefer-code-point": "off", // charCodeAt is intentional for the code-unit hashes
      "unicorn/no-array-sort": "off", // default lexicographic sort is intentional + deterministic for builds
      "sonarjs/no-alphabetical-sort": "off", // charcode order is stable across locales for hashing/paths
      // ReDoS rules: no untrusted-input attack surface (static-site build + localhost dev server) and
      // the flagged patterns are simple/linear on trusted author content — so these are noise here.
      "sonarjs/slow-regex": "off",
      "security/detect-unsafe-regex": "off",
      "sonarjs/cognitive-complexity": ["error", 20], // a touch above default for the pipeline/renderer
      // `_`-prefixed names are intentionally unused
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      // intentional non-breaking spaces live in output string/template/regex literals
      "no-irregular-whitespace": ["error", { skipStrings: true, skipTemplates: true, skipComments: true, skipRegExps: true }],
    },
  },
  // node:test tracks unawaited `test(...)` calls itself — floating promises there are idiomatic.
  {
    files: ["**/__tests__/**/*.ts", "**/*.test.ts"],
    rules: { "@typescript-eslint/no-floating-promises": "off" },
  },
  // Node globals for the build pipeline + server (but not the browser module below).
  {
    files: ["scripts/**/*.ts", "server.ts"],
    ignores: ["scripts/dev/**"],
    languageOptions: { globals: globals.node },
  },
  // Browser globals for the in-page modules.
  {
    files: ["theme/dev/javascript-source/**/*.ts", "scripts/dev/**/*.ts"],
    languageOptions: { globals: globals.browser },
  },
);

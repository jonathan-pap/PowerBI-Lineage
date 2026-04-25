/**
 * Ambient declarations for globals that the server injects into the
 * embedded <script> block BEFORE main.ts runs. The generator in
 * src/html-generator.ts emits a single <script> that concatenates:
 *
 *   1. The server-injected data block (const DATA, MARKDOWN, …)
 *   2. The compiled contents of main.js (this module)
 *
 * These declarations keep TypeScript happy when main.ts references
 * those globals. They're typed loosely as `any` — tightening them
 * means importing types from ../data-builder.ts which would pull
 * server-only code into the client tree. A stricter typing pass can
 * land when we carve main.ts into smaller modules.
 *
 * DaxHighlight is defined by vendor/dax-highlight/dax-highlight.js
 * which loads in its own <script> tag earlier in the generated HTML.
 */

/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

// DATA payload is runtime-typed via the `let` reassignment in the
// inline-script template. Kept `any` here because tightening means
// importing server types, which the client tsconfig deliberately
// doesn't pull in. Structured access in call sites is the
// type-check boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let DATA: any;
declare let MARKDOWN: string;
declare let MARKDOWN_MEASURES: string;
declare let MARKDOWN_FUNCTIONS: string;
declare let MARKDOWN_CALCGROUPS: string;
declare let MARKDOWN_DATADICT: string;
declare let MARKDOWN_SOURCES: string;
declare let MARKDOWN_PAGES: string;
declare let MARKDOWN_INDEX: string;
declare let MARKDOWN_IMPROVEMENTS: string;
declare let MARKDOWN_CHANGELOG: string;
declare let MARKDOWN_WELCOME: string;

// Lite-mode counterparts of the per-doc markdowns. Empty string when
// the doc isn't emitted in Lite (Data Dictionary + Index always; others
// when underlying entity list is empty). The dashboard's Docs-tab
// Lite/Detailed toggle picks between MARKDOWN_* and MARKDOWN_*_LITE.
declare let MARKDOWN_LITE: string;
declare let MARKDOWN_MEASURES_LITE: string;
declare let MARKDOWN_FUNCTIONS_LITE: string;
declare let MARKDOWN_CALCGROUPS_LITE: string;
declare let MARKDOWN_DATADICT_LITE: string;
declare let MARKDOWN_SOURCES_LITE: string;
declare let MARKDOWN_PAGES_LITE: string;
declare let MARKDOWN_INDEX_LITE: string;
declare let MARKDOWN_IMPROVEMENTS_LITE: string;

declare let REPORT_NAME: string;
declare let APP_VERSION: string;
declare let GENERATED_AT: string;

declare const DaxHighlight: {
  highlightAll: (root?: ParentNode, selector?: string) => void;
  highlightElement: (el: Element) => void;
  highlightDax: (src: string) => string;
  addFunctions: (names: string[]) => void;
  addKeywords: (names: string[]) => void;
};

// Escape + classifier helpers defined in src/client/render/escape.ts
// and concatenated into the same inline <script> block BEFORE
// main.js runs. See that file's header for context on why they
// aren't ES modules.
declare function escHtml(s: unknown): string;
declare function escAttr(s: unknown): string;
declare function sc(s: string): string;
declare function uc(n: number): string;

// Markdown-render helpers defined in src/client/render/md.ts and
// concatenated alongside escape.ts before main.js runs.
declare function mdRender(md: string): string;
declare function mdEscapeHtml(s: string): string;
declare function mdInline(s: string): string;

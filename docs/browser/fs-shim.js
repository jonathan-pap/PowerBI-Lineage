/**
 * `fs` replacement for browser mode.
 *
 * The existing parser + data-builder are synchronous and use Node's
 * `fs.readFileSync` / `existsSync` / `readdirSync`. In the browser we
 * have no filesystem, but we DO have a `Map<path, text>` pre-loaded
 * from the user's picked folder via `fsa-walk.ts`. This shim serves
 * `fs` calls out of that map so the parser runs unchanged.
 *
 * The browser resolves `import ... from "fs"` to this file via an
 * import-map declared in index.html:
 *
 *     <script type="importmap">
 *       { "imports": { "fs": "./browser/fs-shim.js" } }
 *     </script>
 *
 * Only the subset of `fs` the parser actually uses is implemented.
 * Anything else throws a clear error so silent data-loss is impossible.
 */
let __vfs = null;
/** Install the VFS before running the parser. Called from entry.ts. */
export function __setVFS(vfs) {
    __vfs = vfs;
}
/** Visible for tests. */
export function __resetVFS() {
    __vfs = null;
}
function requireVFS() {
    if (!__vfs) {
        throw new Error("fs-shim: no VFS installed. Call __setVFS() with the loaded file " +
            "map before the parser runs (see src/browser/entry.ts).");
    }
    return __vfs;
}
// ─────────────────────────────────────────────────────────────────────
// Path normalisation — paths from Node's path.join / path.resolve may
// arrive with "\" separators on Windows-like resolver output, mixed
// separators, or trailing slashes. Normalise to forward slashes and
// drop any trailing slash (except root).
// ─────────────────────────────────────────────────────────────────────
function norm(p) {
    let s = p.replace(/\\/g, "/");
    // Collapse duplicate slashes (except the leading one)
    s = s.replace(/\/{2,}/g, "/");
    // Strip trailing slash unless it's just the root
    if (s.length > 1 && s.endsWith("/"))
        s = s.slice(0, -1);
    return s;
}
// ─────────────────────────────────────────────────────────────────────
// Dirent-lookalike — the parser uses `readdirSync(..., {withFileTypes:
// true})` in a couple of places and reads `.name` + `.isDirectory()`.
// ─────────────────────────────────────────────────────────────────────
class BrowserDirent {
    name;
    _isDir;
    constructor(name, _isDir) {
        this.name = name;
        this._isDir = _isDir;
    }
    isDirectory() { return this._isDir; }
    isFile() { return !this._isDir; }
    isSymbolicLink() { return false; }
    isBlockDevice() { return false; }
    isCharacterDevice() { return false; }
    isFIFO() { return false; }
    isSocket() { return false; }
}
// ─────────────────────────────────────────────────────────────────────
// Public `fs.*` API subset
// ─────────────────────────────────────────────────────────────────────
/**
 * Read a file's text contents. Throws an ENOENT-shaped error when
 * missing, matching Node's behaviour closely enough for the parser's
 * try/catch blocks to keep working.
 */
export function readFileSync(p, _encoding) {
    const vfs = requireVFS();
    const content = vfs.files.get(norm(p));
    if (content === undefined) {
        const err = new Error(`ENOENT: no such file or directory, open '${p}'`);
        err.code = "ENOENT";
        throw err;
    }
    return content;
}
/** True when `p` is a known file OR a known directory prefix. */
export function existsSync(p) {
    if (!__vfs)
        return false;
    const target = norm(p);
    if (__vfs.files.has(target))
        return true;
    // Directory check: any known file that lives under this prefix
    const prefix = target + "/";
    for (const key of __vfs.files.keys()) {
        if (key.startsWith(prefix))
            return true;
    }
    return false;
}
/**
 * List the direct children of a directory. Returns strings by default,
 * Dirent-lookalikes when `withFileTypes: true`. Each child appears
 * exactly once; files come before subdirectories (parsers don't care
 * about order in practice but stability is nicer for tests).
 */
export function readdirSync(p, opts) {
    if (!__vfs)
        return [];
    const dir = norm(p);
    const prefix = dir === "/" ? "/" : dir + "/";
    const fileNames = new Set();
    const dirNames = new Set();
    for (const key of __vfs.files.keys()) {
        if (!key.startsWith(prefix))
            continue;
        const rest = key.slice(prefix.length);
        if (!rest)
            continue;
        const slash = rest.indexOf("/");
        if (slash < 0)
            fileNames.add(rest);
        else
            dirNames.add(rest.slice(0, slash));
    }
    const files = [...fileNames].sort();
    const dirs = [...dirNames].sort();
    if (opts && opts.withFileTypes) {
        return [
            ...files.map(n => new BrowserDirent(n, false)),
            ...dirs.map(n => new BrowserDirent(n, true)),
        ];
    }
    return [...files, ...dirs];
}
/**
 * Writable operations aren't needed for the browser dashboard (the app
 * is read-only against the picked folder), so we throw loudly rather
 * than pretend. If a caller ever tries to write, it's a bug that would
 * silently data-loss; a thrown error is the better failure mode.
 */
export function writeFileSync(_p, _data) {
    throw new Error("fs-shim: writeFileSync is not supported in browser mode");
}
export function mkdirSync(_p, _opts) {
    throw new Error("fs-shim: mkdirSync is not supported in browser mode");
}
// Default export for `import * as fs from "fs"` usage pattern.
export default {
    readFileSync,
    existsSync,
    readdirSync,
    writeFileSync,
    mkdirSync,
};

/**
 * `path` replacement for browser mode — POSIX-style.
 *
 * Node's `path` module has Windows and POSIX variants; in the browser
 * we pick POSIX (forward slashes, no drive letters) for everything.
 * Paths passed to the parser are all synthetic — rooted at `/virt/...`
 * — so native OS path conventions don't matter here.
 *
 * Only the subset the parser + data-builder + md-generator actually
 * use is implemented. Everything else throws so we catch misuse early.
 */
function normalizeParts(parts, absolute) {
    const out = [];
    for (const part of parts) {
        if (!part || part === ".")
            continue;
        if (part === "..") {
            if (out.length > 0 && out[out.length - 1] !== "..")
                out.pop();
            else if (!absolute)
                out.push("..");
            continue;
        }
        out.push(part);
    }
    return (absolute ? "/" : "") + out.join("/");
}
/** Join any number of segments using forward slashes, collapsing
 *  `.`/`..` and de-duplicating separators. Returns `"."` for an empty
 *  join, matching Node's `path.posix.join()` behaviour. */
export function join(...segments) {
    const parts = [];
    let absolute = false;
    for (const s of segments) {
        if (!s)
            continue;
        const normalised = s.replace(/\\/g, "/");
        if (normalised.startsWith("/") && parts.length === 0)
            absolute = true;
        for (const p of normalised.split("/"))
            parts.push(p);
    }
    const joined = normalizeParts(parts, absolute);
    return joined || ".";
}
/**
 * Resolve a sequence of paths into an absolute path.
 * Browser has no `process.cwd()`, so we default the base to `"/virt"`
 * — the virtual-root prefix our VFS uses. Any absolute segment mid-
 * sequence resets the resolution target, exactly like Node's POSIX
 * resolve.
 */
export function resolve(...segments) {
    let resolvedPath = "/virt";
    for (const s of segments) {
        if (!s)
            continue;
        const normalised = s.replace(/\\/g, "/");
        if (normalised.startsWith("/"))
            resolvedPath = normalised;
        else
            resolvedPath = resolvedPath + "/" + normalised;
    }
    const parts = resolvedPath.split("/");
    return normalizeParts(parts, true) || "/";
}
/** Return everything before the last separator, or `"."` when there
 *  is no separator. Matches Node's `path.posix.dirname()`. */
export function dirname(p) {
    if (!p)
        return ".";
    const s = p.replace(/\\/g, "/");
    const lastSlash = s.lastIndexOf("/");
    if (lastSlash < 0)
        return ".";
    if (lastSlash === 0)
        return "/";
    return s.slice(0, lastSlash);
}
/**
 * Return the final segment. Optional `ext` arg strips that extension
 * if present — Node behaviour, and used by app.ts to strip `.Report`.
 */
export function basename(p, ext) {
    if (!p)
        return "";
    const s = p.replace(/\\/g, "/");
    const lastSlash = s.lastIndexOf("/");
    let base = lastSlash < 0 ? s : s.slice(lastSlash + 1);
    if (ext && base.endsWith(ext))
        base = base.slice(0, base.length - ext.length);
    return base;
}
export function extname(p) {
    const b = basename(p);
    const dot = b.lastIndexOf(".");
    if (dot <= 0)
        return "";
    return b.slice(dot);
}
/** Forward slash for POSIX. */
export const sep = "/";
// Default export for `import * as path from "path"` usage pattern.
export default {
    join,
    resolve,
    dirname,
    basename,
    extname,
    sep,
    posix: undefined, // intentionally unavailable — throw if used
    win32: undefined,
};

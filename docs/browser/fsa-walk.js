/**
 * File System Access API → VFS loader.
 *
 * The browser can't read arbitrary disk paths synchronously, but the
 * parser IS synchronous. Solution: walk the picked directory handle
 * once (async), collect every text file into a `Map<path, text>`,
 * then install it as the VFS. Parser then runs against the pre-loaded
 * map as if it were a real filesystem.
 *
 * We only pull in text files we'll actually parse — TMDL, JSON, BIM,
 * PBIR. Binary assets (images, custom-visual bundles, data files)
 * are skipped to keep memory lean even on large reports.
 *
 * The picked folder is the PARENT of the `.Report` + `.SemanticModel`
 * siblings — matching how Node CLI users point at the PBIP project
 * root. The walker preserves the picked-folder name as the first
 * segment under `/virt/` so `findSemanticModelPath()` can find the
 * sibling directories naturally.
 */
/**
 * Only text files the parser reads. Keeps the map small. Anything
 * else under the picked folder (images, binaries, etc.) is skipped
 * entirely — we never even call `.getFile()` on them.
 */
function shouldRead(name) {
    const lower = name.toLowerCase();
    return (lower.endsWith(".tmdl") ||
        lower.endsWith(".json") ||
        lower.endsWith(".bim") ||
        lower.endsWith(".pbir") ||
        lower === "definition.pbir" || // already covered by .pbir but kept for clarity
        lower === "version.json" ||
        lower === "report.json");
}
/**
 * Entries that should never be descended into. Skips the Power BI
 * `.pbi/` cache folder, `node_modules/` if someone weirdly picked a
 * dev folder, and `.git/` — all legitimately-possible contents of a
 * project root that would just bloat the walk.
 */
function shouldSkipDir(name) {
    return (name === ".pbi" ||
        name === "node_modules" ||
        name === ".git" ||
        name.startsWith(".vs"));
}
/**
 * Walk a directory handle recursively, loading every text-file we care
 * about into the returned map. Keys are `/virt/<pickedFolderName>/…`
 * using forward slashes.
 */
export async function walkDirectoryHandle(handle, pickedFolderName) {
    const files = new Map();
    const root = `/virt/${pickedFolderName}`;
    await walk(handle, root, files);
    return files;
}
async function walk(dir, currentPath, out) {
    // `.entries()` is async-iterable on DirectoryHandle; it yields
    // [name, handle] pairs.
    for await (const [name, child] of dir.entries()) {
        const childPath = currentPath + "/" + name;
        if (child.kind === "directory") {
            if (shouldSkipDir(name))
                continue;
            await walk(child, childPath, out);
            continue;
        }
        if (child.kind === "file" && shouldRead(name)) {
            try {
                const file = await child.getFile();
                const text = await file.text();
                out.set(childPath, text);
            }
            catch (e) {
                // Log and continue — a single unreadable file (locked by
                // another process, permissions) shouldn't abort the whole load.
                // eslint-disable-next-line no-console
                console.warn(`[fsa-walk] could not read ${childPath}: ${e.message}`);
            }
        }
    }
}
/**
 * Detect whether the current browser supports the APIs we need.
 * Used by the entry shell to show a friendly error on Firefox/Safari.
 */
export function isFsaSupported() {
    return typeof globalThis.showDirectoryPicker === "function";
}

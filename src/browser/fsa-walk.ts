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

// File System Access API types aren't in every TS lib bundle — declare
// the minimum surface we use. Browsers that don't support the API
// (Firefox, Safari) lack `window.showDirectoryPicker` entirely and
// we catch that in the entry shell before getting here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DirHandle = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FileHandle = any;

/**
 * Only text files the parser reads. Keeps the map small. Anything
 * else under the picked folder (images, binaries, etc.) is skipped
 * entirely — we never even call `.getFile()` on them.
 */
function shouldRead(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".tmdl") ||
    lower.endsWith(".json") ||
    lower.endsWith(".bim") ||
    lower.endsWith(".pbir") ||
    lower === "definition.pbir" ||   // already covered by .pbir but kept for clarity
    lower === "version.json" ||
    lower === "report.json"
  );
}

/**
 * Entries that should never be descended into. Skips the Power BI
 * `.pbi/` cache folder, `node_modules/` if someone weirdly picked a
 * dev folder, and `.git/` — all legitimately-possible contents of a
 * project root that would just bloat the walk.
 */
function shouldSkipDir(name: string): boolean {
  return (
    name === ".pbi" ||
    name === "node_modules" ||
    name === ".git" ||
    name.startsWith(".vs")
  );
}

/**
 * Walk a directory handle recursively, loading every text-file we care
 * about into the returned map. Keys are `/virt/<pickedFolderName>/…`
 * using forward slashes.
 */
export async function walkDirectoryHandle(
  handle: DirHandle,
  pickedFolderName: string,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const root = `/virt/${pickedFolderName}`;
  await walk(handle, root, files);
  return files;
}

async function walk(
  dir: DirHandle,
  currentPath: string,
  out: Map<string, string>,
): Promise<void> {
  // `.entries()` is async-iterable on DirectoryHandle; it yields
  // [name, handle] pairs.
  for await (const [name, child] of dir.entries() as AsyncIterable<[string, DirHandle | FileHandle]>) {
    const childPath = currentPath + "/" + name;
    if (child.kind === "directory") {
      if (shouldSkipDir(name)) continue;
      await walk(child, childPath, out);
      continue;
    }
    if (child.kind === "file" && shouldRead(name)) {
      try {
        const file = await child.getFile();
        const text = await file.text();
        out.set(childPath, text);
      } catch (e) {
        // Log and continue — a single unreadable file (locked by
        // another process, permissions) shouldn't abort the whole load.
        // eslint-disable-next-line no-console
        console.warn(`[fsa-walk] could not read ${childPath}: ${(e as Error).message}`);
      }
    }
  }
}

/**
 * Detect whether the current browser supports the APIs we need.
 * Used by the entry shell to show a friendly error on Firefox/Safari.
 */
export function isFsaSupported(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

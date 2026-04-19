/**
 * Browser-mode shim tests.
 *
 * The shims are pure-logic modules — no DOM, no FSA API. That makes
 * them testable under Node's built-in test runner the same way every
 * other module in the repo is tested. The FSA walker itself can't be
 * unit-tested here (it needs real `FileSystemDirectoryHandle` objects
 * which only exist in a browser), but behaviour-critical invariants
 * of the shims can be.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync, existsSync, readdirSync,
  writeFileSync, mkdirSync,
  __setVFS, __resetVFS,
} from "../src/browser/fs-shim.js";
import {
  join, resolve, dirname, basename, extname, sep,
} from "../src/browser/path-shim.js";

// ─────────────────────────────────────────────────────────────────────
// path-shim — must match Node's path.posix for the operations the
// parser uses. These are the concrete call sites from model-parser /
// data-builder / md-generator, so any drift here breaks parsing.
// ─────────────────────────────────────────────────────────────────────

test("path-shim: sep is '/'", () => {
  assert.equal(sep, "/");
});

test("path-shim: join concatenates and normalises", () => {
  assert.equal(join("/virt", "foo", "bar.tmdl"), "/virt/foo/bar.tmdl");
  assert.equal(join("/virt", "", "bar"), "/virt/bar");
  assert.equal(join("a", "b", "..", "c"), "a/c");
  assert.equal(join("/a", "b/c", "d"), "/a/b/c/d");
});

test("path-shim: join returns '.' on empty inputs", () => {
  assert.equal(join(), ".");
  assert.equal(join(""), ".");
});

test("path-shim: resolve produces absolute paths rooted in /virt by default", () => {
  assert.equal(resolve("a"), "/virt/a");
  assert.equal(resolve("a", "b"), "/virt/a/b");
  assert.equal(resolve("/foo", "bar"), "/foo/bar");
  assert.equal(resolve("/foo", "/bar", "baz"), "/bar/baz");
});

test("path-shim: resolve collapses . and ..", () => {
  assert.equal(resolve("/a/b", "..", "c"), "/a/c");
  assert.equal(resolve("/a", "./b/./c"), "/a/b/c");
});

test("path-shim: dirname walks up one level; returns / or . at root", () => {
  assert.equal(dirname("/a/b/c"), "/a/b");
  assert.equal(dirname("/a"), "/");
  assert.equal(dirname("a"), ".");
  assert.equal(dirname(""), ".");
});

test("path-shim: basename returns the final segment", () => {
  assert.equal(basename("/a/b/c.tmdl"), "c.tmdl");
  assert.equal(basename("c.tmdl"), "c.tmdl");
  assert.equal(basename("/a/b/"), "");
});

test("path-shim: basename strips optional extension arg", () => {
  assert.equal(basename("/a/b/Model.Report", ".Report"), "Model");
  assert.equal(basename("c.tmdl", ".tmdl"), "c");
  // Mismatched ext → no-op
  assert.equal(basename("c.tmdl", ".xml"), "c.tmdl");
});

test("path-shim: extname returns leading dot + extension", () => {
  assert.equal(extname("foo.tmdl"), ".tmdl");
  assert.equal(extname("foo"), "");
  assert.equal(extname(".hidden"), "");
  assert.equal(extname("a.b.c"), ".c");
});

test("path-shim: handles Windows-style backslashes on input", () => {
  // Some Node helpers produce backslash paths on Windows; the shim
  // must cope with those as if they were forward slashes since it's
  // pretending to be POSIX.
  assert.equal(join("\\virt\\foo", "bar"), "/virt/foo/bar");
  assert.equal(dirname("C:\\a\\b"), "C:/a");
  assert.equal(basename("\\a\\b\\c.tmdl"), "c.tmdl");
});

// ─────────────────────────────────────────────────────────────────────
// fs-shim — reading from the installed VFS
// ─────────────────────────────────────────────────────────────────────

function vfs(files: Record<string, string>): void {
  __setVFS({ files: new Map(Object.entries(files)) });
}

test("fs-shim: readFileSync returns the text content of a known path", () => {
  vfs({
    "/virt/Health.SemanticModel/definition/tables/Dim.tmdl": "table Dim\n",
  });
  assert.equal(
    readFileSync("/virt/Health.SemanticModel/definition/tables/Dim.tmdl", "utf8"),
    "table Dim\n",
  );
});

test("fs-shim: readFileSync throws ENOENT for unknown paths", () => {
  vfs({ "/virt/a.txt": "hello" });
  let caught: (Error & { code?: string }) | null = null;
  try {
    readFileSync("/virt/missing.tmdl");
  } catch (e) {
    caught = e as Error & { code?: string };
  }
  assert.ok(caught, "expected readFileSync to throw");
  assert.equal(caught!.code, "ENOENT",
    "error.code must be ENOENT so parser try/catch blocks that check for missing files work");
});

test("fs-shim: existsSync distinguishes files, directory prefixes, and absent paths", () => {
  vfs({
    "/virt/Model.SemanticModel/definition/model.tmdl": "model",
    "/virt/Model.SemanticModel/definition/tables/Dim.tmdl": "t",
  });
  // File
  assert.equal(existsSync("/virt/Model.SemanticModel/definition/model.tmdl"), true);
  // Directory (has children)
  assert.equal(existsSync("/virt/Model.SemanticModel/definition"), true);
  assert.equal(existsSync("/virt/Model.SemanticModel"), true);
  assert.equal(existsSync("/virt"), true);
  // Absent
  assert.equal(existsSync("/virt/Missing.tmdl"), false);
  assert.equal(existsSync("/virt/Model.SemanticModel/definition/roles"), false);
});

test("fs-shim: readdirSync returns immediate children only", () => {
  vfs({
    "/virt/Model.SemanticModel/definition/model.tmdl": "m",
    "/virt/Model.SemanticModel/definition/tables/A.tmdl": "a",
    "/virt/Model.SemanticModel/definition/tables/B.tmdl": "b",
    "/virt/Model.SemanticModel/definition/cultures/en-US.tmdl": "c",
  });
  const children = readdirSync("/virt/Model.SemanticModel/definition");
  assert.deepEqual(
    (children as string[]).sort(),
    ["cultures", "model.tmdl", "tables"],
    "should include model.tmdl (file) + tables + cultures (dirs)",
  );
});

test("fs-shim: readdirSync with withFileTypes returns Dirent-like objects", () => {
  vfs({
    "/virt/root/f.tmdl": "x",
    "/virt/root/sub/g.tmdl": "y",
  });
  const entries = readdirSync("/virt/root", { withFileTypes: true }) as Array<{
    name: string; isDirectory(): boolean; isFile(): boolean;
  }>;
  const byName = new Map(entries.map(e => [e.name, e]));
  assert.equal(byName.get("f.tmdl")!.isFile(), true);
  assert.equal(byName.get("f.tmdl")!.isDirectory(), false);
  assert.equal(byName.get("sub")!.isDirectory(), true);
  assert.equal(byName.get("sub")!.isFile(), false);
});

test("fs-shim: readdirSync on an empty/missing directory returns []", () => {
  vfs({ "/virt/a.tmdl": "hi" });
  const out = readdirSync("/virt/nonexistent");
  assert.deepEqual(out, []);
});

test("fs-shim: writeFileSync + mkdirSync throw in browser mode", () => {
  vfs({});
  assert.throws(() => writeFileSync("/virt/new", "x"));
  assert.throws(() => mkdirSync("/virt/newdir"));
});

test("fs-shim: no VFS installed → requireVFS throws on read attempts", () => {
  __resetVFS();
  assert.throws(() => readFileSync("/virt/x"));
  // existsSync returns false when no VFS is installed — safer than
  // throwing, because callers use it for "is this path there" probes
  // that should just fail the check rather than crash.
  assert.equal(existsSync("/virt/x"), false);
  assert.deepEqual(readdirSync("/virt/x"), []);
});

test("fs-shim: path normalisation tolerates mixed separators + trailing slashes", () => {
  vfs({ "/virt/a/b.tmdl": "ok" });
  // Trailing slash
  assert.equal(existsSync("/virt/a/"), true);
  // Backslashes (Node on Windows can emit these)
  assert.equal(readFileSync("/virt\\a\\b.tmdl"), "ok");
  // Duplicate slashes
  assert.equal(readFileSync("/virt//a//b.tmdl"), "ok");
});

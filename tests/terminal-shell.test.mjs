import test from "node:test";
import assert from "node:assert/strict";
import { resolveShell } from "../core/shell.mjs";

test("Windows uses ComSpec instead of a POSIX shell", () => {
  const shell = resolveShell(
    "win32",
    { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    () => true,
  );
  assert.equal(shell, "C:\\Windows\\System32\\cmd.exe");
  assert.notEqual(shell, "/bin/bash");
});

test("Windows falls back to System32 cmd.exe", () => {
  const shell = resolveShell("win32", {}, () => false);
  assert.equal(shell, "C:\\Windows\\System32\\cmd.exe");
  assert.notEqual(shell, "/bin/bash");
});

test("Linux keeps a valid SHELL and falls back to sh", () => {
  assert.equal(
    resolveShell("linux", { SHELL: "/bin/bash" }, (candidate) => candidate === "/bin/bash"),
    "/bin/bash",
  );
  assert.equal(
    resolveShell("linux", { SHELL: "/bin/bash" }, (candidate) => candidate === "/bin/sh"),
    "/bin/sh",
  );
});

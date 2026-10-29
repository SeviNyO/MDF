import test from "node:test";
import assert from "node:assert/strict";
import { availableShells, resolveShell, selectShell } from "../core/shell.mjs";

test("Windows defaults to Git Bash when installed", () => {
  const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
  const shell = resolveShell(
    "win32",
    { ProgramFiles: "C:\\Program Files", ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    (candidate) => candidate === gitBash || candidate === "C:\\Windows\\System32\\cmd.exe",
  );
  assert.equal(shell, gitBash);
  assert.deepEqual(selectShell("git-bash", "win32", { ProgramFiles: "C:\\Program Files" }, (candidate) => candidate === gitBash).args, ["--login", "-i"]);
  assert.notEqual(shell, "/bin/bash");
});

test("Windows lists selectable shells and respects the user's choice", () => {
  const paths = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "C:\\Windows\\System32\\cmd.exe",
  ];
  const exists = (candidate) => paths.includes(candidate);
  assert.deepEqual(availableShells("win32", {}, exists).map(({ id }) => id), ["git-bash", "powershell", "cmd"]);
  assert.equal(resolveShell("win32", {}, exists, "powershell"), paths[1]);
  assert.equal(resolveShell("win32", {}, exists, "cmd"), paths[2]);
});

test("Windows falls back to System32 cmd.exe when Git Bash is not installed", () => {
  const shell = resolveShell("win32", {}, () => false);
  assert.equal(shell, "C:\\Windows\\System32\\cmd.exe");
  assert.notEqual(shell, "/bin/bash");
});

test("Windows detects Git Bash in the user's PATH", () => {
  const gitBash = "D:\\Tools\\Git\\bin\\bash.exe";
  assert.equal(resolveShell("win32", { Path: "D:\\Tools\\Git\\bin" }, (candidate) => candidate === gitBash), gitBash);
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

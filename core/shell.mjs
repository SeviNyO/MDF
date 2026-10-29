import fs from "node:fs";
import path from "node:path";

const WINDOWS_SHELLS = [
  { id: "git-bash", label: "Git Bash", args: ["--login", "-i"] },
  { id: "powershell", label: "PowerShell", args: ["-NoLogo"] },
  { id: "cmd", label: "Símbolo del sistema", args: [] },
];

/** Detecta ejecutables conocidos; nunca acepta rutas arbitrarias desde la UI. */
export function availableShells(platform = process.platform, env = process.env, fileExists = fs.existsSync) {
  if (platform !== "win32") {
    const executable = [env.SHELL, "/bin/bash", "/bin/sh"].find((candidate) => candidate && fileExists(candidate)) || "/bin/sh";
    return [{ id: "system", label: path.basename(executable), executable, args: [] }];
  }

  const programFiles = [env.ProgramFiles, env["ProgramFiles(x86)"], "C:\\Program Files", "C:\\Program Files (x86)"];
  const gitCandidates = [
    ...programFiles.filter(Boolean).map((dir) => path.win32.join(dir, "Git", "bin", "bash.exe")),
    ...(env.LOCALAPPDATA ? [path.win32.join(env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe")] : []),
  ];
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  const pathEntries = (env.Path || env.PATH || "").split(";").filter(Boolean);
  const find = (candidates) => candidates.find((candidate) => candidate && fileExists(candidate));
  const paths = {
    "git-bash": find([...gitCandidates, ...pathEntries.map((dir) => path.win32.join(dir, "bash.exe"))]),
    powershell: find([
      path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ...pathEntries.map((dir) => path.win32.join(dir, "powershell.exe")),
    ]),
    cmd: find([env.ComSpec, env.COMSPEC, path.win32.join(systemRoot, "System32", "cmd.exe")])
      || path.win32.join(systemRoot, "System32", "cmd.exe"),
  };
  return WINDOWS_SHELLS.filter(({ id }) => paths[id]).map(({ id, label, args }) => ({ id, label, args, executable: paths[id] }));
}

export function selectShell(preferredId, platform = process.platform, env = process.env, fileExists = fs.existsSync) {
  const shells = availableShells(platform, env, fileExists);
  return shells.find(({ id }) => id === preferredId) || shells[0];
}

// Compatibilidad con los comandos existentes y los scripts que solo requieren la ruta.
export function resolveShell(platform = process.platform, env = process.env, fileExists = fs.existsSync, preferredId) {
  return selectShell(preferredId, platform, env, fileExists).executable;
}

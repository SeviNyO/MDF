import fs from "node:fs";
import path from "node:path";

/**
 * Devuelve un shell ejecutable para la plataforma actual.
 * En Windows no se debe usar `SHELL` ni `/bin/bash`: el valor habitual es
 * `ComSpec` (cmd.exe). En Linux/macOS se respeta `SHELL` y se comprueba que
 * exista antes de entregarlo a node-pty.
 */
export function resolveShell(
  platform = process.platform,
  env = process.env,
  fileExists = fs.existsSync,
) {
  const exists = (candidate) => Boolean(candidate) && fileExists(candidate);

  if (platform === "win32") {
    const systemRoot = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
    const fallback = path.win32.join(systemRoot, "System32", "cmd.exe");
    return [env.ComSpec, env.COMSPEC, fallback].find(exists) || fallback;
  }

  const candidates = [env.SHELL, "/bin/bash", "/bin/sh"];
  return candidates.find(exists) || "/bin/sh";
}

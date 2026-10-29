#!/usr/bin/env node
// Copia el binario de Typst a vendor/ para empaquetarlo en la app.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const isWin = process.platform === "win32";
const dest = path.join("vendor", isWin ? "typst.exe" : "typst");
if (fs.existsSync(dest)) {
  console.log(`${isWin ? "typst.exe" : "typst"} ya está en vendor/`);
  process.exit(0);
}

const candidates = isWin
  ? [
      process.env.TYPST_PATH,
      path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Typst", "typst.exe"),
      "C:\\Program Files\\Typst\\typst.exe",
    ]
  : [
      process.env.TYPST_PATH,
      path.join(os.homedir(), ".local", "bin", "typst"),
      "/usr/local/bin/typst",
      "/usr/bin/typst",
    ];
const source = candidates.find((file) => file && fs.existsSync(file));

if (!source) {
  console.error(
    "No se encontró typst. Instálalo o define TYPST_PATH.\n" +
      "Linux: descarga typst-x86_64-unknown-linux-musl.tar.xz y copia el binario a vendor/typst.\n" +
      "Windows: descarga typst-x86_64-pc-windows-msvc.zip y copia typst.exe a vendor/typst.exe.\n" +
      "Descargas: https://github.com/typst/typst/releases",
  );
  process.exit(1);
}

fs.mkdirSync("vendor", { recursive: true });
fs.copyFileSync(fs.realpathSync(source), dest);
if (!isWin) fs.chmodSync(dest, 0o755);
console.log(`typst copiado desde ${source} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);

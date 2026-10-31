import { execSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

function refreshPath() {
  const cargoBin = join(homedir(), ".cargo", "bin");

  if (process.platform === "win32") {
    try {
      const machine = execSync(
        "powershell -NoProfile -Command \"[Environment]::GetEnvironmentVariable('Path','Machine')\"",
        { encoding: "utf8" },
      ).trim();
      const user = execSync(
        "powershell -NoProfile -Command \"[Environment]::GetEnvironmentVariable('Path','User')\"",
        { encoding: "utf8" },
      ).trim();
      process.env.PATH = [machine, user, cargoBin].filter(Boolean).join(";");
      return;
    } catch {
      // fall through
    }
  }

  const current = process.env.PATH ?? process.env.Path ?? "";
  if (!current.toLowerCase().includes(".cargo")) {
    const sep = process.platform === "win32" ? ";" : ":";
    process.env.PATH = `${cargoBin}${sep}${current}`;
  }
}

refreshPath();

const args = process.argv.slice(2);
const bin =
  process.platform === "win32"
    ? join(process.cwd(), "node_modules", ".bin", "tauri.cmd")
    : join(process.cwd(), "node_modules", ".bin", "tauri");

const result = spawnSync(bin, args, {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);

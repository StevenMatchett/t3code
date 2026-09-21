// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";

export function browserCommand(
  url: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): { command: string; args: string[] } | null {
  const parsed = new URL(url);
  if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("Invalid PR URL.");
  if (env.SSH_CONNECTION || env.SSH_TTY) return null;
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32")
    return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
  if (platform === "linux" && (env.DISPLAY || env.WAYLAND_DISPLAY))
    return { command: "xdg-open", args: [url] };
  return null;
}

export async function openBrowser(url: string): Promise<boolean> {
  const launch = browserCommand(
    url,
    HostProcessPlatform.defaultValue(),
    HostProcessEnvironment.defaultValue(),
  );
  if (!launch) return false;
  await new Promise<void>((resolve, reject) => {
    // The browser must outlive the TUI without keeping its terminal session open.
    const child = NodeChildProcess.spawn(launch.command, launch.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () =>
      reject(new Error("Could not launch your browser. Open or copy the link below.")),
    );
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  return true;
}

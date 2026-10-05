// @effect-diagnostics globalTimers:off -- Native audio runs outside Effect; unref the delayed bell so it cannot keep the TUI alive.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import type { NotificationSound } from "../features/chat/notificationSounds.ts";

/** Small PCM chimes generated locally, so packaged builds need no audio assets. */
export function notificationWave(kind: NotificationSound): Buffer {
  const notes = kind === "input" ? [659.25, 783.99] : [659.25];
  const rate = 24000;
  const duration = 0.32;
  const noteSamples = Math.round(rate * duration);
  const samples = noteSamples * notes.length;
  const wave = Buffer.alloc(44 + samples * 2);
  wave.write("RIFF", 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(rate, 24);
  wave.writeUInt32LE(rate * 2, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const offset = i % noteSamples;
    const t = offset / rate;
    // A soft attack and exponential decay avoid the harsh edge of a system beep.
    const envelope =
      Math.min(1, t / 0.012) * Math.exp(-t / 0.12) * Math.min(1, (duration - t) / 0.035);
    const frequency = notes[Math.floor(i / noteSamples)]!;
    const tone =
      Math.sin(2 * Math.PI * frequency * t) + 0.1 * Math.sin(4 * Math.PI * frequency * t);
    wave.writeInt16LE(Math.round(tone * envelope * 16000), 44 + i * 2);
  }
  return wave;
}

/** SSH carries terminal bells to the client; native chimes stay on local sessions. */
export function createNotificationAudio(
  platform = HostProcessPlatform.defaultValue(),
  environment = HostProcessEnvironment.defaultValue(),
  ringBell = () => {
    // OpenTUI captures stdout.write; write the control byte directly to the terminal.
    if (NodeProcess.stdout.isTTY) NodeFS.writeSync(NodeProcess.stdout.fd, "\x07");
  },
) {
  const remote = Boolean(environment.SSH_CONNECTION || environment.SSH_TTY);
  let bellTimer: ReturnType<typeof setTimeout> | undefined;
  let directory: string | undefined;
  let child: NodeChildProcess.ChildProcess | undefined;
  let closed = false;
  let generation = 0;
  const stop = () => {
    generation++;
    clearTimeout(bellTimer);
    bellTimer = undefined;
    child?.kill();
    child = undefined;
  };
  return {
    play(kind: NotificationSound) {
      if (closed || child || bellTimer) return;
      try {
        if (remote) {
          ringBell();
          if (kind === "input") {
            bellTimer = setTimeout(() => {
              bellTimer = undefined;
              if (!closed) {
                try {
                  ringBell();
                } catch {
                  /* The terminal may have disconnected. */
                }
              }
            }, 350);
            bellTimer.unref();
          }
          return;
        }
        if (!directory) {
          directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-tui-sounds-"));
          for (const sound of ["input", "completion"] as const)
            NodeFS.writeFileSync(NodePath.join(directory, `${sound}.wav`), notificationWave(sound));
        }
        const path = NodePath.join(directory, `${kind}.wav`);
        const players: [string, string[]][] =
          platform === "darwin"
            ? [["afplay", [path]]]
            : platform === "win32"
              ? [
                  [
                    "powershell.exe",
                    [
                      "-NoProfile",
                      "-NonInteractive",
                      "-Command",
                      `$player = New-Object System.Media.SoundPlayer; $player.SoundLocation = '${path.replaceAll("'", "''")}'; $player.PlaySync()`,
                    ],
                  ],
                ]
              : [
                  ["paplay", [path]],
                  ["pw-play", [path]],
                  ["aplay", ["-q", path]],
                ];
        const current = generation;
        const attempt = (index: number) => {
          const player = players[index];
          if (!player || closed || current !== generation) return;
          const running = NodeChildProcess.spawn(player[0], player[1], {
            stdio: "ignore",
            windowsHide: true,
            timeout: 5000,
          });
          child = running;
          // Failed spawns also emit close; handle fallback there exactly once.
          running.on("error", () => undefined);
          running.once("close", (code) => {
            if (child === running) child = undefined;
            if (code !== 0) attempt(index + 1);
          });
        };
        attempt(0);
      } catch {
        // Audio is optional; unavailable devices must not interrupt a conversation.
      }
    },
    stop,
    close() {
      if (closed) return;
      closed = true;
      const cleanup = () => {
        if (!directory) return;
        try {
          NodeFS.rmSync(directory, { recursive: true, force: true });
        } catch {
          // A locked temporary file must not prevent the TUI from closing.
        }
      };
      // Windows players can keep the WAV open until their process exits.
      if (child) child.once("close", cleanup);
      else cleanup();
      stop();
    },
  };
}

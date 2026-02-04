/**
 * Secrets Sandbox Extension - Protects credentials from agent access
 *
 * This extension:
 * 1. Strips sensitive environment variables at module load
 * 2. Uses OS-level sandboxing to block read access to credential files
 * 3. Replaces the bash tool with a sandboxed version
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { type BashOperations, createBashTool } from "@mariozechner/pi-coding-agent";

// Strip sensitive env vars IMMEDIATELY at module load (before any tool calls)
// Only block what we actually send to the container
const SENSITIVE_ENV_VARS = [
  "PI_AUTH",   // base64-encoded auth.json
  "SECRETS",   // base64-encoded secrets.json
  "GH_TOKEN",  // GitHub token for gh CLI
];

for (const envVar of SENSITIVE_ENV_VARS) {
  delete process.env[envVar];
}

// Files to protect from reading
const PROTECTED_FILES = [
  "/root/.pi/agent/auth.json",     // Pi's default auth location
  "/root/.pi/agent/secrets.json",  // Project-level secrets
];

function createSandboxedBashOps(): BashOperations {
  return {
    async exec(command, cwd, { onData, signal, timeout }) {
      if (!existsSync(cwd)) {
        throw new Error(`Working directory does not exist: ${cwd}`);
      }

      const wrappedCommand = await SandboxManager.wrapWithSandbox(command);

      return new Promise((resolve, reject) => {
        const child = spawn("bash", ["-c", wrappedCommand], {
          cwd,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let timedOut = false;
        let timeoutHandle: NodeJS.Timeout | undefined;

        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            if (child.pid) {
              try {
                process.kill(-child.pid, "SIGKILL");
              } catch {
                child.kill("SIGKILL");
              }
            }
          }, timeout * 1000);
        }

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        child.on("error", (err) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          reject(err);
        });

        const onAbort = () => {
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          }
        };

        signal?.addEventListener("abort", onAbort, { once: true });

        child.on("close", (code) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          signal?.removeEventListener("abort", onAbort);

          if (signal?.aborted) {
            reject(new Error("aborted"));
          } else if (timedOut) {
            reject(new Error(`timeout:${timeout}`));
          } else {
            resolve({ exitCode: code });
          }
        });
      });
    },
  };
}

export default function (pi: ExtensionAPI) {
  const localCwd = process.cwd();
  const localBash = createBashTool(localCwd);

  let sandboxEnabled = false;
  let sandboxInitialized = false;

  // Override the bash tool with sandboxed version
  pi.registerTool({
    ...localBash,
    label: "bash (secrets protected)",
    async execute(id, params, signal, onUpdate, _ctx) {
      if (!sandboxEnabled || !sandboxInitialized) {
        return localBash.execute(id, params, signal, onUpdate);
      }

      const sandboxedBash = createBashTool(localCwd, {
        operations: createSandboxedBashOps(),
      });
      return sandboxedBash.execute(id, params, signal, onUpdate);
    },
  });

  // Also sandbox user bash commands (! prefix)
  pi.on("user_bash", () => {
    if (!sandboxEnabled || !sandboxInitialized) return;
    return { operations: createSandboxedBashOps() };
  });

  // Block read tool access to protected files
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "read") {
      const path = event.input.path as string;
      const isProtected = PROTECTED_FILES.some((p) => path.includes(p) || path.endsWith(p.replace("/root", "")));

      if (isProtected) {
        if (ctx.hasUI) {
          ctx.ui.notify(`Blocked read of protected file: ${path}`, "warning");
        }
        return { block: true, reason: `Access denied: ${path} is protected` };
      }
    }
    return undefined;
  });

  // Initialize sandbox on session start
  pi.on("session_start", async (_event, ctx) => {
    const platform = process.platform;
    if (platform !== "darwin" && platform !== "linux") {
      sandboxEnabled = false;
      if (ctx.hasUI) {
        ctx.ui.notify(`Secrets sandbox not supported on ${platform}`, "warning");
      }
      return;
    }

    try {
      await SandboxManager.initialize({
        filesystem: {
          denyRead: PROTECTED_FILES,
          allowWrite: [".", "/tmp"],
          denyWrite: [],
        },
        network: {
          allowedDomains: ["*"],
          deniedDomains: [],
        },
      });

      sandboxEnabled = true;
      sandboxInitialized = true;

      if (ctx.hasUI) {
        ctx.ui.setStatus(
          "secrets-sandbox",
          ctx.ui.theme.fg("accent", `🔒 Secrets protected: ${PROTECTED_FILES.length} files`)
        );
        ctx.ui.notify("Secrets sandbox initialized", "info");
      }
    } catch (err) {
      sandboxEnabled = false;
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Secrets sandbox initialization failed: ${err instanceof Error ? err.message : err}`,
          "error"
        );
      }
    }
  });

  // Cleanup on session end
  pi.on("session_shutdown", async () => {
    if (sandboxInitialized) {
      try {
        await SandboxManager.reset();
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  // Command to show protection status
  pi.registerCommand("secrets", {
    description: "Show secrets protection status",
    handler: async (_args, ctx) => {
      const status = sandboxEnabled
        ? `Secrets sandbox is ENABLED\nProtected files: ${PROTECTED_FILES.join(", ")}\nStripped env vars: ${SENSITIVE_ENV_VARS.join(", ")}`
        : "Secrets sandbox is DISABLED";
      if (ctx.hasUI) {
        ctx.ui.notify(status, "info");
      }
    },
  });
}

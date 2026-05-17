import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { execFileSync } from "node:child_process";
import { RelayConfigSchema, type RelayConfig } from "./config/relay-config.js";

export type DoctorStatus = "ok" | "warning" | "error";

export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  message: string;
  remediation?: string;
}

export interface DoctorReport {
  status: DoctorStatus;
  checks: DoctorCheck[];
}

function combineStatus(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "error")) return "error";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "ok";
}

function commandExists(command: string): boolean {
  if (isAbsolute(command) || command.includes("/")) {
    try {
      accessSync(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      try {
        accessSync(join(dir, `${command}${ext}`), constants.X_OK);
        return true;
      } catch {
        // Keep searching PATH entries.
      }
    }
  }
  return false;
}

function parseConfig(configPath: string): { config?: RelayConfig; check: DoctorCheck } {
  if (!existsSync(configPath)) {
    return {
      check: {
        id: "config",
        status: "warning",
        message: ".relay/config.json is missing.",
        remediation: "Run `relay init` to create local Relay configuration."
      }
    };
  }

  try {
    const parsed = RelayConfigSchema.parse(JSON.parse(readFileSync(configPath, "utf8")));
    return {
      config: parsed,
      check: {
        id: "config",
        status: "ok",
        message: ".relay/config.json is valid."
      }
    };
  } catch (error) {
    return {
      check: {
        id: "config",
        status: "error",
        message: `.relay/config.json is invalid: ${(error as Error).message}`,
        remediation: "Fix the JSON and schema errors, or rerun `relay init` to recreate defaults."
      }
    };
  }
}

function validateJsonFile(path: string, id: string, label: string, missingStatus: DoctorStatus, missingRemediation: string): DoctorCheck {
  if (!existsSync(path)) {
    return {
      id,
      status: missingStatus,
      message: `${label} is missing.`,
      remediation: missingRemediation
    };
  }

  try {
    JSON.parse(readFileSync(path, "utf8"));
    return { id, status: "ok", message: `${label} is valid JSON.` };
  } catch (error) {
    return {
      id,
      status: "error",
      message: `${label} is invalid JSON: ${(error as Error).message}`,
      remediation: "Restore the file from a snapshot or rerun the related Relay command."
    };
  }
}

export function runRelayDoctor(cwd = process.cwd()): DoctorReport {
  const relayDir = join(cwd, ".relay");
  const checks: DoctorCheck[] = [];

  try {
    execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    checks.push({ id: "git", status: "ok", message: "Git is available and the workspace is inside a repository." });
  } catch {
    checks.push({
      id: "git",
      status: "error",
      message: "Git is unavailable or the workspace is not inside a repository.",
      remediation: "Run Relay inside a git repository with git available on PATH."
    });
  }

  checks.push(existsSync(relayDir)
    ? { id: "relay_workspace", status: "ok", message: ".relay workspace exists." }
    : {
        id: "relay_workspace",
        status: "warning",
        message: ".relay workspace is missing.",
        remediation: "Run `relay init` before starting a session or sending prompts."
      });

  const { config, check: configCheck } = parseConfig(join(relayDir, "config.json"));
  checks.push(configCheck);

  checks.push(validateJsonFile(
    join(relayDir, "memory", "semantic-state.json"),
    "semantic_state",
    ".relay/memory/semantic-state.json",
    "warning",
    "Run `relay init` to create semantic state."
  ));

  const sessionPath = join(relayDir, "session.json");
  const sessionCheck = validateJsonFile(
    sessionPath,
    "session",
    ".relay/session.json",
    "warning",
    "Run `relay session start` to anchor a session."
  );
  checks.push(sessionCheck);
  if (sessionCheck.status === "ok") {
    const session = JSON.parse(readFileSync(sessionPath, "utf8")) as Record<string, unknown>;
    const missing = ["base_git_sha", "prefix_hash"].filter((key) => typeof session[key] !== "string" || session[key] === "");
    checks.push(missing.length === 0
      ? { id: "session_fields", status: "ok", message: "Session base SHA and prefix hash are present." }
      : {
          id: "session_fields",
          status: "error",
          message: `Session is missing required field(s): ${missing.join(", ")}.`,
          remediation: "Run `relay session start` to recreate session metadata."
        });
  }

  if (config) {
    const { warningLimit, requireConfirmationAbove, hardLimit } = config.tokens;
    checks.push(warningLimit <= requireConfirmationAbove && requireConfirmationAbove <= hardLimit
      ? { id: "token_budget_order", status: "ok", message: "Token budget thresholds are ordered correctly." }
      : {
          id: "token_budget_order",
          status: "error",
          message: "Token budget thresholds must satisfy warningLimit <= requireConfirmationAbove <= hardLimit.",
          remediation: "Edit .relay/config.json token limits into ascending order."
        });

    const defaultProvider = config.provider.default;
    const providerCommand = config.provider.commands?.[defaultProvider];
    checks.push(providerCommand?.[0] && commandExists(providerCommand[0])
      ? { id: "provider_command", status: "ok", message: `Default provider '${defaultProvider}' command is available.` }
      : {
          id: "provider_command",
          status: "warning",
          message: `Default provider '${defaultProvider}' is not configured or its command is unavailable.`,
          remediation: "Add provider.commands for the default provider in .relay/config.json."
        });

    const gcCommand = config.gc.command ?? providerCommand;
    checks.push(gcCommand?.[0] && commandExists(gcCommand[0])
      ? { id: "gc_command", status: "ok", message: "GC command is available." }
      : {
          id: "gc_command",
          status: "warning",
          message: "GC command is not configured or unavailable.",
          remediation: "Configure gc.command or a valid default provider command in .relay/config.json."
        });
  }

  return { status: combineStatus(checks), checks };
}

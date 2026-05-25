import { spawn } from "node:child_process";
import type { RelayConfig } from "../config/relay-config.js";
import type { ProviderAdapter } from "./provider.js";

const PROVIDER_DEFAULTS: Record<string, string[]> = {
  claude: ["claude"],
  openai: ["sgpt"],
  aider: ["aider", "--no-git"],
  llm: ["llm"],
  copilot: ["gh", "copilot", "suggest", "-t", "shell"],
  local: ["ollama", "run", "--nowordwrap", "qwen2.5-coder:7b"],
  "ollama-local": ["ollama", "run", "--nowordwrap", "qwen2.5-coder:7b"],
};

const DISALLOWED_GENERATION_MODELS = new Set([
  "nomic-embed-text",
  "mxbai-embed-large",
  "all-minilm",
]);

export function assertModelSupportsGeneration(model: string): void {
  if (DISALLOWED_GENERATION_MODELS.has(model.toLowerCase())) {
    throw new Error(
      `Model '${model}' does not support text generation. Configure routing.gc with a generative local model.`
    );
  }
}

export class ShellProvider implements ProviderAdapter {
  constructor(
    public name: string,
    public readonly command: string,
    private args: string[] = [],
    private timeoutMs: number = 300_000
  ) {}

  get commandLine(): string {
    return [this.command, ...this.args].join(" ");
  }

  get commandTemplate(): string[] {
    return [this.command, ...this.args];
  }

  async sendPrompt(payload: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, this.args, { stdio: ["pipe", "inherit", "inherit"] });
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`Provider '${this.command}' timed out after ${this.timeoutMs / 1000}s.`));
      }, this.timeoutMs);
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      child.stdin.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "EPIPE") finish(() => reject(err));
      });
      child.stdin.write(payload);
      child.stdin.end();
      child.on("exit", (code) => {
        if (code === null) {
          finish(() => reject(new Error(`Provider '${this.command}' was terminated by a signal before it could exit.`)));
        } else {
          finish(() => resolve(code));
        }
      });
      child.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT")
          finish(() => reject(new Error(`'${this.command}' not found in PATH.`)));
        else finish(() => reject(err));
      });
    });
  }
}

export function createShellProvider(name: string, config: RelayConfig): ShellProvider {
  const template = config.provider.commands?.[name] ?? PROVIDER_DEFAULTS[name];
  if (!template || template.length === 0) {
    const known = Object.keys(PROVIDER_DEFAULTS);
    throw new Error(
      `Unknown provider '${name}'. Built-in providers: ${known.join(", ")}. ` +
      `To add a custom provider, set provider.commands["${name}"] in .relay/config.json.`
    );
  }
  const [command, ...args] = template;
  return new ShellProvider(name, command, args);
}

export type RelayTask = "ask" | "gc" | "diff" | "summarize" | "default";

export function resolveProviderNameForTask(task: RelayTask, config: RelayConfig): string {
  return (task !== "default" && config.routing?.[task]) ? config.routing[task]! : config.provider.default;
}

export function createShellProviderForTask(task: RelayTask, config: RelayConfig): ShellProvider {
  const providerName = resolveProviderNameForTask(task, config);
  return createShellProvider(providerName, config);
}

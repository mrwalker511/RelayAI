import { spawn } from "node:child_process";
import { basename } from "node:path";
import type { RelayConfig } from "../config/relay-config.js";
import type { ProviderAdapter, ProviderResult, SendPromptOptions } from "./provider.js";

const PROVIDER_DEFAULTS: Record<string, string[]> = {
  claude: ["claude"],
  openai: ["sgpt"],
  codex: ["codex", "exec", "-"],
  aider: ["aider", "--no-git"],
  llm: ["llm"],
  copilot: ["copilot", "-p", "{prompt}"],
  local: ["ollama", "run", "--nowordwrap", "qwen2.5-coder:7b"],
  "ollama-local": ["ollama", "run", "--nowordwrap", "qwen2.5-coder:7b"],
};

/** Providers whose command template injects the payload as an argv element instead of stdin. */
export const PROMPT_PLACEHOLDER = "{prompt}";

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

  /**
   * Returns a provider that emits machine-readable usage:
   *   - claude -> append ["--output-format","json"] unless already configured.
   *   - codex  -> ensure "--json" is present, inserted right AFTER the "exec"
   *               sub-command (so `codex exec --json -`, not after a trailing "-").
   * Any other provider is a no-op.
   */
  withMeasure(): ShellProvider {
    const bin = basename(this.command);
    if (bin === "claude") {
      if (this.args.includes("--output-format")) return this;
      return new ShellProvider(this.name, this.command, [...this.args, "--output-format", "json"], this.timeoutMs);
    }
    if (bin === "codex") {
      if (this.args.includes("--json")) return this;
      const nextArgs = [...this.args];
      const execIdx = nextArgs.indexOf("exec");
      if (execIdx >= 0) nextArgs.splice(execIdx + 1, 0, "--json");
      else nextArgs.unshift("--json");
      return new ShellProvider(this.name, this.command, nextArgs, this.timeoutMs);
    }
    return this;
  }

  async sendPrompt(payload: string, opts: SendPromptOptions = {}): Promise<ProviderResult> {
    // Providers with a {prompt} placeholder receive the payload as an argv
    // element (no shell -> injection-safe); stdin is then left empty.
    const usesPlaceholder = this.args.some((a) => a.includes(PROMPT_PLACEHOLDER));
    const args = usesPlaceholder
      ? this.args.map((a) => a.split(PROMPT_PLACEHOLDER).join(payload))
      : this.args;
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, args, {
        stdio: ["pipe", opts.capture ? "pipe" : "inherit", "inherit"]
      });
      const chunks: Buffer[] = [];
      // Tee captured stdout: the user still sees it in real time, and we buffer
      // it so usage metadata can be parsed after the process exits.
      if (opts.capture && child.stdout) {
        child.stdout.on("data", (chunk: Buffer) => {
          process.stdout.write(chunk);
          chunks.push(chunk);
        });
      }
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
      const stdin = child.stdin;
      if (!stdin) {
        finish(() => reject(new Error(`Provider '${this.command}' did not expose stdin.`)));
        return;
      }
      stdin.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "EPIPE") finish(() => reject(err));
      });
      // When the prompt is delivered as an argv element, don't also pipe it to stdin.
      if (!usesPlaceholder) stdin.write(payload);
      stdin.end();
      child.on("exit", (code) => {
        if (code === null) {
          finish(() => reject(new Error(`Provider '${this.command}' was terminated by a signal before it could exit.`)));
        } else {
          finish(() => resolve({
            exitCode: code,
            capturedOutput: opts.capture ? Buffer.concat(chunks).toString("utf8") : undefined
          }));
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

const SHELL_METACHARACTERS = /[;&|><`$\\]/;

function validateProviderCommand(template: string[], providerName: string): void {
  if (template.length === 0) return;
  const [command, ...args] = template;
  if (SHELL_METACHARACTERS.test(command)) {
    throw new Error(
      `Provider '${providerName}' command contains forbidden shell characters: ${command}\n` +
      `Only simple command names and paths are allowed in provider.commands.`
    );
  }
  for (const arg of args) {
    if (typeof arg !== "string") {
      throw new Error(`Provider '${providerName}' command args must all be strings.`);
    }
  }
}

export function createShellProvider(name: string, config: RelayConfig): ShellProvider {
  const isBuiltin = name in PROVIDER_DEFAULTS && !config.provider.commands?.[name];
  const template = config.provider.commands?.[name] ?? PROVIDER_DEFAULTS[name];
  if (!template || template.length === 0) {
    const known = Object.keys(PROVIDER_DEFAULTS);
    throw new Error(
      `Unknown provider '${name}'. Built-in providers: ${known.join(", ")}. ` +
      `To add a custom provider, set provider.commands["${name}"] in .relay/config.json.`
    );
  }
  // Validate user-configured commands; built-in defaults are pre-vetted
  if (!isBuiltin) {
    validateProviderCommand(template, name);
  }
  const [command, ...args] = template;
  return new ShellProvider(name, command, args);
}

/**
 * Resolve a provider name requested on the command line. An omitted name and
 * the literal alias "default" both resolve to config.provider.default, unless
 * the user has explicitly configured a provider named "default".
 */
export function resolveProviderName(requested: string | undefined, config: RelayConfig): string {
  if (!requested) return config.provider.default;
  if (requested === "default" && !config.provider.commands?.["default"]) return config.provider.default;
  return requested;
}

export type RelayTask = "ask" | "gc" | "diff" | "summarize" | "default";

export function resolveProviderNameForTask(task: RelayTask, config: RelayConfig): string {
  return (task !== "default" && config.routing?.[task]) ? config.routing[task]! : config.provider.default;
}

export function createShellProviderForTask(task: RelayTask, config: RelayConfig): ShellProvider {
  const providerName = resolveProviderNameForTask(task, config);
  return createShellProvider(providerName, config);
}

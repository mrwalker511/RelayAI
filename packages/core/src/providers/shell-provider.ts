import { spawn } from "node:child_process";
import type { RelayConfig } from "../config/relay-config.js";
import type { ProviderAdapter } from "./provider.js";

const PROVIDER_DEFAULTS: Record<string, string[]> = {};

export class ShellProvider implements ProviderAdapter {
  constructor(
    public name: string,
    public readonly command: string,
    private args: string[] = []
  ) {}

  get commandLine(): string {
    return [this.command, ...this.args].join(" ");
  }

  async sendPrompt(payload: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, this.args, { stdio: ["pipe", "inherit", "inherit"] });
      child.stdin.write(payload);
      child.stdin.end();
      child.on("exit", (code) => resolve(code ?? 0));
      child.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT")
          reject(new Error(`'${this.command}' not found in PATH.`));
        else reject(err);
      });
    });
  }
}

export function createShellProvider(name: string, config: RelayConfig): ShellProvider {
  const template = config.provider.commands?.[name] ?? PROVIDER_DEFAULTS[name];
  if (!template || template.length === 0) throw new Error(
    `Unknown provider '${name}'. Add it to provider.commands in .relay/config.json.`
  );
  const [command, ...args] = template;
  return new ShellProvider(name, command, args);
}

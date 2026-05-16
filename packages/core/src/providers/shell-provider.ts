import { spawn } from "node:child_process";
import type { ProviderAdapter } from "./provider.js";

export class ShellProvider implements ProviderAdapter {
  constructor(public name: string, private command: string, private args: string[] = []) {}

  async sendPrompt(payload: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, this.args, { stdio: ["pipe", "inherit", "inherit"] });
      child.stdin.write(payload);
      child.stdin.end();
      child.on("exit", (code) => resolve(code ?? 0));
      child.on("error", reject);
    });
  }
}

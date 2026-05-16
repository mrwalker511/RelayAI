import { createHash } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function getPrefixHash(staticBlock: string, stateLayer: string): string {
  return sha256(`${staticBlock}\n${stateLayer}`);
}

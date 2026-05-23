import { getEncoding } from "js-tiktoken";

export interface TokenEstimate {
  tokens: number;
  tokenizer: string;
}

let _enc: ReturnType<typeof getEncoding> | null = null;

function getEncoder(): ReturnType<typeof getEncoding> | null {
  if (!_enc) {
    try {
      _enc = getEncoding("cl100k_base");
    } catch {
      return null;
    }
  }
  return _enc;
}

export function estimateTokens(text: string): TokenEstimate {
  const enc = getEncoder();
  if (enc) {
    return { tokens: enc.encode(text).length, tokenizer: "cl100k_base" };
  }
  return { tokens: Math.ceil(text.length / 4), tokenizer: "char_div_4_fallback" };
}

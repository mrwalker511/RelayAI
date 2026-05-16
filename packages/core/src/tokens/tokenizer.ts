import { getEncoding } from "js-tiktoken";

export interface TokenEstimate {
  tokens: number;
  tokenizer: string;
}

export function estimateTokens(text: string): TokenEstimate {
  try {
    const enc = getEncoding("cl100k_base");
    return { tokens: enc.encode(text).length, tokenizer: "cl100k_base" };
  } catch {
    return { tokens: Math.ceil(text.length / 4), tokenizer: "char_div_4_fallback" };
  }
}

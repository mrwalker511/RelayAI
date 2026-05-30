export interface ProviderResult {
  exitCode: number;
  /** Buffered provider stdout, present only when sendPrompt was called with { capture: true }. */
  capturedOutput?: string;
}

export interface SendPromptOptions {
  /** Capture (and tee) the provider's stdout so usage metadata can be parsed. */
  capture?: boolean;
}

export interface ProviderAdapter {
  name: string;
  sendPrompt(payload: string, opts?: SendPromptOptions): Promise<ProviderResult>;
}

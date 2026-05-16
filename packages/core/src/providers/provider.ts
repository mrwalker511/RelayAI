export interface ProviderAdapter {
  name: string;
  sendPrompt(payload: string): Promise<number>;
}

import Anthropic from "@anthropic-ai/sdk";
import type { ProviderAdapter } from "./provider.js";

// Zone tags emitted by payload-builder.ts
const ZONE_RE = {
  staticBlock: /<STATIC_BLOCK>\n([\s\S]*?)\n<\/STATIC_BLOCK>/,
  stateLayer: /<STATE_LAYER>\n([\s\S]*?)\n<\/STATE_LAYER>/,
  dynamicInput: /<DYNAMIC_INPUT>\n([\s\S]*?)\n<\/DYNAMIC_INPUT>/,
};

interface ParsedZones {
  staticBlock: string;
  stateLayer: string;
  dynamicInput: string;
}

function parsePayload(payload: string): ParsedZones | null {
  const s = payload.match(ZONE_RE.staticBlock);
  const st = payload.match(ZONE_RE.stateLayer);
  const d = payload.match(ZONE_RE.dynamicInput);
  if (!s || !st || !d) return null;
  return { staticBlock: s[1], stateLayer: st[1], dynamicInput: d[1] };
}

export class AnthropicProvider implements ProviderAdapter {
  readonly name: string;
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(name = "raw-anthropic", model = "claude-opus-4-7", maxTokens = 16000) {
    this.name = name;
    this.client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
    this.model = model;
    this.maxTokens = maxTokens;
  }

  async sendPrompt(payload: string): Promise<number> {
    const zones = parsePayload(payload);

    // When the payload contains Relay's three-zone structure, split it so the two stable
    // zones land in cached prefix positions and only DYNAMIC_INPUT crosses the cache boundary.
    // STATIC_BLOCK → system (cached once per project setup)
    // STATE_LAYER  → first user content block (cached per session)
    // DYNAMIC_INPUT → second user content block (volatile, never cached)
    let systemParam: Anthropic.TextBlockParam[] | undefined;
    let messages: Anthropic.MessageParam[];

    if (zones) {
      systemParam = [
        {
          type: "text",
          text: zones.staticBlock,
          cache_control: { type: "ephemeral" },
        },
      ];
      messages = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: zones.stateLayer,
              cache_control: { type: "ephemeral" },
            },
            {
              type: "text",
              text: zones.dynamicInput,
            },
          ],
        },
      ];
    } else {
      messages = [{ role: "user", content: payload }];
    }

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      thinking: { type: "adaptive" },
      ...(systemParam ? { system: systemParam } : {}),
      messages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        process.stdout.write(event.delta.text);
      }
    }
    process.stdout.write("\n");
    return 0;
  }
}

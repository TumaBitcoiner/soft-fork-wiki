import Anthropic from "@anthropic-ai/sdk";
import type {
  ClassifyInput,
  SentimentClassifier,
  StanceResult,
  SummarizeInput,
} from "./types.js";
import {
  STANCE_SYSTEM,
  parseStanceJson,
  stanceUserPrompt,
  summaryPrompt,
} from "./prompt.js";
import type { Stance } from "@soft-fork-wiki/shared";

/**
 * Claude backend. Defaults to Haiku — a 3-way stance classification over short
 * posts is exactly the kind of high-volume, well-scoped task Haiku is built for.
 * Override with CLAUDE_MODEL (e.g. a larger model for spot-checking).
 */
export class ClaudeClassifier implements SentimentClassifier {
  readonly name = "claude";
  private client = new Anthropic();
  private model = process.env.CLAUDE_MODEL ?? "claude-haiku-4-5";

  async classifyNote(input: ClassifyInput): Promise<StanceResult> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 256,
      system: STANCE_SYSTEM,
      messages: [{ role: "user", content: stanceUserPrompt(input) }],
    });

    const text = res.content.find((b) => b.type === "text");
    const parsed = parseStanceJson(text && "text" in text ? text.text : "{}");
    return {
      stance: parsed.stance as Stance,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
    };
  }

  async summarize(input: SummarizeInput): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 400,
      messages: [{ role: "user", content: summaryPrompt(input) }],
    });
    const text = res.content.find((b) => b.type === "text");
    return text && "text" in text ? text.text.trim() : "";
  }
}

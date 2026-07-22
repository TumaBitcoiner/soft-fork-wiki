import { GoogleGenAI } from "@google/genai";
import type {
  ClassifyInput,
  SentimentClassifier,
  StanceResult,
  SummarizeInput,
} from "./types.js";
import {
  STANCE_SYSTEM,
  stanceUserPrompt,
  summaryPrompt,
} from "./prompt.js";
import type { Stance } from "@soft-fork-wiki/shared";

/**
 * Gemini Flash backend. Flash (not Pro) is the right tier here — the task is a
 * lightweight per-note classification, and Flash is the fast/cheap option.
 * Override with GEMINI_MODEL if you ever want a heavier model.
 */
export class GeminiClassifier implements SentimentClassifier {
  readonly name = "gemini";
  private client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  private model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

  async classifyNote(input: ClassifyInput): Promise<StanceResult> {
    const res = await this.client.models.generateContent({
      model: this.model,
      contents: `${STANCE_SYSTEM}\n\n${stanceUserPrompt(input)}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            stance: { type: "string", enum: ["favour", "against", "neutral"] },
            confidence: { type: "number" },
            rationale: { type: "string" },
          },
          required: ["stance", "confidence", "rationale"],
        },
      },
    });

    const parsed = JSON.parse(res.text ?? "{}");
    return {
      stance: parsed.stance as Stance,
      confidence: Number(parsed.confidence) || 0,
      rationale: String(parsed.rationale ?? ""),
    };
  }

  async summarize(input: SummarizeInput): Promise<string> {
    const res = await this.client.models.generateContent({
      model: this.model,
      contents: summaryPrompt(input),
    });
    return (res.text ?? "").trim();
  }
}

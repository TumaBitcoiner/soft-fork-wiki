/**
 * Shared prompt text, so Claude and Gemini classify against identical
 * instructions and their outputs stay comparable.
 */
import type { ClassifyInput, SummarizeInput } from "./types.js";

export const STANCE_SYSTEM = [
  "You analyze public Nostr posts about Bitcoin Improvement Proposals (BIPs).",
  "Classify the author's stance toward the specific BIP as exactly one of:",
  '"favour" (supportive), "against" (opposed), or "neutral" (mentions it',
  "without taking a side, asks a question, or is off-topic).",
  "Judge only the stance toward that BIP, not general Bitcoin sentiment.",
  "",
  "Respond with ONLY a JSON object, no prose and no code fences:",
  '{"stance":"favour|against|neutral","confidence":0..1,"rationale":"one sentence"}',
].join(" ");

/** Strip code fences / stray prose and parse the first JSON object. */
export function parseStanceJson(raw: string): {
  stance: string;
  confidence: number;
  rationale: string;
} {
  const match = raw.match(/\{[\s\S]*\}/);
  const obj = match ? JSON.parse(match[0]) : {};
  return {
    stance: String(obj.stance ?? "neutral"),
    confidence: Number(obj.confidence) || 0,
    rationale: String(obj.rationale ?? ""),
  };
}

export function stanceUserPrompt(input: ClassifyInput): string {
  const title = input.bipTitle ? ` ("${input.bipTitle}")` : "";
  return [
    `BIP ${input.bipNumber}${title}.`,
    "",
    "Post:",
    input.noteContent,
    "",
    "Respond with the author's stance, a confidence from 0 to 1, and a short",
    "one-sentence rationale.",
  ].join("\n");
}

export function summaryPrompt(input: SummarizeInput): string {
  const title = input.bipTitle ? ` ("${input.bipTitle}")` : "";
  const samples = input.sampleNotes
    .slice(0, 8)
    .map((n, i) => `${i + 1}. ${n.replace(/\s+/g, " ").slice(0, 280)}`)
    .join("\n");
  return [
    `Summarize how the Nostr network feels about BIP ${input.bipNumber}${title}.`,
    `Tallies: ${input.favour} in favour, ${input.against} against, ${input.neutral} neutral.`,
    "",
    "Representative posts:",
    samples,
    "",
    "Write ONE plain-language paragraph (2-3 sentences) a non-technical person",
    "can understand. State the overall lean and the main points each side makes.",
    "Do not invent facts beyond the posts and tallies. Output only the paragraph.",
  ].join("\n");
}

/** JSON shape both providers must return for a classification. */
export const STANCE_JSON_SCHEMA = {
  type: "object",
  properties: {
    stance: { type: "string", enum: ["favour", "against", "neutral"] },
    confidence: { type: "number" },
    rationale: { type: "string" },
  },
  required: ["stance", "confidence", "rationale"],
  additionalProperties: false,
} as const;

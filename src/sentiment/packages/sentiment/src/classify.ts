/**
 * Classify a batch of Nostr notes with a chosen provider.
 */
import type { Event } from "nostr-tools";
import type { ClassifiedNote } from "@soft-fork-wiki/shared";
import type { SentimentClassifier } from "./providers/index.js";

/** How many classifications to run at once. Keep modest to respect rate limits. */
const CONCURRENCY = 5;

export async function classifyNotes(
  classifier: SentimentClassifier,
  bipNumber: number,
  notes: Event[],
  bipTitle?: string,
): Promise<ClassifiedNote[]> {
  const out: ClassifiedNote[] = [];

  for (let i = 0; i < notes.length; i += CONCURRENCY) {
    const batch = notes.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (note): Promise<ClassifiedNote | null> => {
        try {
          const r = await classifier.classifyNote({
            bipNumber,
            bipTitle,
            noteContent: note.content,
          });
          return {
            eventId: note.id,
            pubkey: note.pubkey,
            content: note.content,
            createdAt: note.created_at,
            stance: r.stance,
            confidence: r.confidence,
            rationale: r.rationale,
          };
        } catch (err) {
          // Skip a note that fails to classify rather than aborting the run.
          console.warn(`classify failed for ${note.id}:`, err);
          return null;
        }
      }),
    );
    out.push(...results.filter((r): r is ClassifiedNote => r !== null));
  }

  return out;
}

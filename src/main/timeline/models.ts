// Helpers for interpreting the `sessions.models_used` CSV column.
//
// Claude Code stamps a handful of *pseudo-models* into transcripts — most
// notably "<synthetic>", the model tag on locally-generated notices (usage-limit
// messages, interrupts, errors). These are never real billable models. If a
// pseudo-model survives into `models_used`, the analytics attribution (which
// splits a session's token totals evenly across every model in the list) hands
// it a share of real tokens, producing a phantom "unpriced" row that also
// *undercounts* the real model it stole from. Strip them before attributing.

/** True for a Claude Code placeholder model id like "<synthetic>" — anything
 * wrapped in angle brackets is a pseudo-model, never a real one. */
export function isPseudoModel(model: string): boolean {
  const m = model.trim();
  return m.startsWith('<') && m.endsWith('>');
}

/** Parse a `sessions.models_used` CSV into the real (non-pseudo) model ids,
 * trimmed and empties dropped. */
export function realModels(modelsUsed: string | null | undefined): string[] {
  return (modelsUsed ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
    .filter((m) => !isPseudoModel(m));
}

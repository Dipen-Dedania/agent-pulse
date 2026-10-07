// GitHub star nudge — the renderer-facing slice of UserConfig.starNudge.
// See star-nudge-plan.md.
//
// Two copy voices, assigned at random once per install and then frozen so a
// user always reads one consistent voice across every placement.
export type StarVoice = 'earnest' | 'playful';

// Which moment fired the one-time milestone toast. Drives the toast's copy row.
export type StarMilestoneKind = 'week' | 'backlog';

// Projected from UserConfig.starNudge by the `star:get-state` handler and
// pushed via `star:state-updated` broadcasts.
export interface StarNudgeState {
  voice: StarVoice;
  // A star control was clicked somewhere → every placement hides for good.
  // We can't verify the star without GitHub auth, so a click counts.
  starred: boolean;
  // Main stamped a milestone and the user hasn't answered the toast yet.
  toastPending: boolean;
  milestoneKind: StarMilestoneKind | null;
}

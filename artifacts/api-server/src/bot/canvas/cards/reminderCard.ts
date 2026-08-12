// The reminder and warning cards share one scaffold (see warningCard.ts) so
// the two enforcement cards stay visually identical apart from colour, icon and
// copy. This module re-exports the reminder entry point for the render worker.
export { renderReminderCard, type EnforcementCardView } from "./warningCard";

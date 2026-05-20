// Inngest client for Oral Examiner. The `id` here is the Inngest app id —
// keep it stable across the account so functions register under a clean
// namespace (separate from harkness-helper / ai-documenter / etc.).
//
// Local dev: `npx inngest-cli dev` discovers /api/inngest at localhost:3001
// without env keys. Production: INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY come
// from the Inngest dashboard (same env-scoped pair the rest of the suite uses).

import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "oral-examiner" });

/** Event names. Centralized so producers + consumers stay in sync. */
export const EXAM_COMPLETED_EVENT = "exam.completed";

export type ExamCompletedEvent = {
  name: typeof EXAM_COMPLETED_EVENT;
  data: {
    exam_session_id: string;
  };
};

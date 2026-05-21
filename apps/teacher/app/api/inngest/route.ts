// Inngest function registry endpoint. Inngest's runtime calls this URL to
// discover registered functions and to invoke them when events match.
//
// Local: `npx inngest-cli dev` polls this at http://localhost:3001/api/inngest.
// Prod: Inngest cloud calls https://oral-examiner-v2-sgs-teacher.vercel.app/api/inngest.

import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { evaluateExam } from "@/lib/inngest/evaluate-exam";
import { sweepStaleExamSessions } from "@/lib/inngest/sweep-stale-sessions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [evaluateExam, sweepStaleExamSessions],
});

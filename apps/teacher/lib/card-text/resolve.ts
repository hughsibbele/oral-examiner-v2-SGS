// Resolve the effective card-text strings for a teacher.
//
// Stack of fallbacks per field:
//   1. teacher's own override column (teachers.card_*) — null if unset
//   2. system default row in card_text_defaults (singleton id=1)
//   3. DEFAULT_EXAM_CARD_TEXT compiled into @oral-examiner/canvas — only
//      reached if the defaults row is missing/corrupt
//
// Called by the install path before composing the branded card so every
// teacher gets fresh text on each install (no caching — admin can edit the
// defaults and the next install picks them up).

import { DEFAULT_EXAM_CARD_TEXT, type ExamCardText } from "@oral-examiner/canvas";
import { createAdminClient } from "@/lib/supabase/admin";

type TeacherOverrides = {
  card_kicker?: string | null;
  card_title?: string | null;
  card_body?: string | null;
  card_cta_label?: string | null;
  card_footnote?: string | null;
};

type SystemDefaults = {
  kicker: string;
  title: string;
  body: string;
  cta_label: string;
  footnote: string;
};

export async function resolveCardTextForTeacher(
  teacherId: string,
): Promise<ExamCardText> {
  const admin = createAdminClient();

  // Fetch both rows in parallel — admin client bypasses RLS, which is
  // fine here because the data is non-sensitive and the install path
  // already established teacher identity.
  const [teacherRes, defaultsRes] = await Promise.all([
    admin
      .from("teachers")
      .select(
        "card_kicker, card_title, card_body, card_cta_label, card_footnote",
      )
      .eq("id", teacherId)
      .maybeSingle(),
    admin
      .from("card_text_defaults")
      .select("kicker, title, body, cta_label, footnote")
      .eq("id", 1)
      .maybeSingle(),
  ]);

  const teacher = (teacherRes.data ?? {}) as TeacherOverrides;
  const defaults = (defaultsRes.data ?? null) as SystemDefaults | null;

  return {
    kicker:
      teacher.card_kicker ??
      defaults?.kicker ??
      DEFAULT_EXAM_CARD_TEXT.kicker,
    title:
      teacher.card_title ??
      defaults?.title ??
      DEFAULT_EXAM_CARD_TEXT.title,
    body:
      teacher.card_body ?? defaults?.body ?? DEFAULT_EXAM_CARD_TEXT.body,
    ctaLabel:
      teacher.card_cta_label ??
      defaults?.cta_label ??
      DEFAULT_EXAM_CARD_TEXT.ctaLabel,
    footnote:
      teacher.card_footnote ??
      defaults?.footnote ??
      DEFAULT_EXAM_CARD_TEXT.footnote,
  };
}

/** Resolve just the defaults (no teacher overrides). Used by the admin
 *  edit surface to show the current system-default values. */
export async function loadCardTextDefaults(): Promise<ExamCardText> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("card_text_defaults")
    .select("kicker, title, body, cta_label, footnote")
    .eq("id", 1)
    .maybeSingle();
  const defaults = (data ?? null) as SystemDefaults | null;
  return {
    kicker: defaults?.kicker ?? DEFAULT_EXAM_CARD_TEXT.kicker,
    title: defaults?.title ?? DEFAULT_EXAM_CARD_TEXT.title,
    body: defaults?.body ?? DEFAULT_EXAM_CARD_TEXT.body,
    ctaLabel: defaults?.cta_label ?? DEFAULT_EXAM_CARD_TEXT.ctaLabel,
    footnote: defaults?.footnote ?? DEFAULT_EXAM_CARD_TEXT.footnote,
  };
}

/** Fetch a teacher's per-field overrides (null = inherit). Used by the
 *  teacher-side edit UI to render current state. */
export async function loadTeacherCardOverrides(
  teacherId: string,
): Promise<{
  card_kicker: string | null;
  card_title: string | null;
  card_body: string | null;
  card_cta_label: string | null;
  card_footnote: string | null;
}> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("teachers")
    .select(
      "card_kicker, card_title, card_body, card_cta_label, card_footnote",
    )
    .eq("id", teacherId)
    .maybeSingle();
  return {
    card_kicker: (data?.card_kicker as string | null) ?? null,
    card_title: (data?.card_title as string | null) ?? null,
    card_body: (data?.card_body as string | null) ?? null,
    card_cta_label: (data?.card_cta_label as string | null) ?? null,
    card_footnote: (data?.card_footnote as string | null) ?? null,
  };
}

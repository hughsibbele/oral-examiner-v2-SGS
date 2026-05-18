/**
 * Active-term filter for Canvas sync + dashboard rendering.
 *
 * EHS term names follow patterns like:
 *   "2025/2026 - High School - Full Yr/1st Sem"
 *   "2025/2026 - High School - 2nd Semester"
 *   "2025/2026a - High School - 1st Semester"
 *
 * Active = `term.name` starts with the current academic year's `YYYY/YYYY`
 * prefix. The cutover is August: before August we're still in the previous
 * academic year; August onward we've crossed into the new one. Ported
 * byte-for-byte from AI Documenter so the filter behaves identically.
 *
 * Filtering by term.name instead of the course's display name / course_code
 * matters because EHS courses are typically named with a short prefix
 * ("2526-..." for 2025/2026) that wouldn't match the `YYYY/YYYY` shape —
 * the term name on Canvas is what carries the canonical academic-year tag.
 */
export function activeAcademicYearPrefix(now: Date = new Date()): string {
  const month = now.getMonth(); // 0-indexed
  const year = now.getFullYear();
  if (month >= 7) {
    // August or later → start of the next academic year
    return `${year}/${year + 1}`;
  }
  return `${year - 1}/${year}`;
}

export function isActiveTerm(
  termName: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!termName) return false;
  return termName.startsWith(activeAcademicYearPrefix(now));
}

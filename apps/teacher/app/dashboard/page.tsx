import Link from "next/link";
import { getTeacher } from "@/lib/auth/teacher";
import { createServerSupabase } from "@/lib/supabase/server";
import { RefreshCoursesButton } from "./RefreshCoursesButton";

type CoursePayload = {
  id: number;
  name: string;
  course_code?: string;
  workflow_state: string;
  term?: { id: number; name: string };
};

type CourseRow = {
  canvas_course_id: string;
  payload: CoursePayload;
  last_synced_at: string;
};

export default async function DashboardPage() {
  const result = await getTeacher();
  const teacher = result?.teacher;
  const hasToken = !!teacher?.canvas_token_encrypted;

  const supabase = await createServerSupabase();
  const { data: courseRows } = hasToken
    ? await supabase
        .from("canvas_course_cache")
        .select("canvas_course_id, payload, last_synced_at")
        .order("last_synced_at", { ascending: false })
    : { data: null };

  const courses = (courseRows ?? []) as unknown as CourseRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="heading text-2xl">Welcome, {teacher?.display_name}.</h1>
        <p className="muted text-sm mt-1">{teacher?.email}</p>
      </div>

      {!hasToken ? (
        <section className="surface p-5">
          <h2 className="heading text-lg mb-2">Connect Canvas</h2>
          <p className="text-sm mb-3">
            OE v2 needs a Canvas API token to read your courses + assignments and
            (eventually) post oral-defense submissions on the student&apos;s behalf.
          </p>
          <Link href="/dashboard/canvas" className="btn btn-primary">
            Connect Canvas →
          </Link>
        </section>
      ) : (
        <>
          <section className="surface p-5">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="heading text-lg">Courses</h2>
              <Link href="/dashboard/canvas" className="muted text-xs">
                Canvas settings →
              </Link>
            </div>

            {courses.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm muted">
                  No courses cached yet. Sync from Canvas to populate.
                </p>
                <RefreshCoursesButton />
              </div>
            ) : (
              <div className="space-y-3">
                <RefreshCoursesButton />
                <ul className="divide-y divide-rule border border-rule rounded">
                  {courses.map((row) => {
                    const c = row.payload;
                    return (
                      <li key={row.canvas_course_id}>
                        <Link
                          href={`/dashboard/courses/${row.canvas_course_id}`}
                          className="flex items-baseline justify-between gap-4 p-3 no-underline text-ink hover:bg-paper"
                        >
                          <div>
                            <div className="font-medium">{c.name}</div>
                            <div className="muted text-xs mt-0.5">
                              {c.course_code ?? "—"}
                              {c.term?.name && ` · ${c.term.name}`}
                            </div>
                          </div>
                          <span className="muted text-xs whitespace-nowrap">
                            {c.workflow_state}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <p className="muted text-xs">
                  {courses.length} course{courses.length === 1 ? "" : "s"} cached.
                  Active-term filter is on by default.
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

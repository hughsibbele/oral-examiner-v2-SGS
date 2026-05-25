import { redirect } from "next/navigation";
import Link from "next/link";
import { getTeacher } from "@/lib/auth/teacher";
import { bootstrapAdminIfNeeded, isAdmin } from "@/lib/auth/admin";
import { BrandHeader } from "@/components/BrandHeader";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const teacherResult = await getTeacher();
  if (!teacherResult) redirect("/login?next=/admin");

  const bootstrap = await bootstrapAdminIfNeeded();

  const admin = await isAdmin();
  if (!admin) {
    return (
      <div className="flex min-h-screen flex-col bg-paper">
        <BrandHeader
          title="Oral Examiner"
          right={
            <Link
              href="/dashboard"
              className="text-cool-gray transition-colors hover:text-maroon text-sm"
            >
              ← Dashboard
            </Link>
          }
        />
        <main className="max-w-3xl mx-auto flex-1 px-6 py-12">
          <h1 className="heading text-2xl mb-4">Admin access required</h1>
          <p className="text-sm leading-relaxed">
            This page is restricted to ecosystem admins. You&apos;re signed in as{" "}
            <span className="font-medium">{teacherResult.teacher.email}</span>.
          </p>
          {bootstrap.reason && (
            <p className="muted text-xs mt-4">Bootstrap diagnostic: {bootstrap.reason}</p>
          )}
        </main>
      </div>
    );
  }

  const nav = (
    <nav className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-sm">
      <Link
        href="/admin"
        className="text-ink transition-colors hover:text-dark-blue"
      >
        Overview
      </Link>
      <Link
        href="/admin/agents"
        className="text-ink transition-colors hover:text-dark-blue"
      >
        Agents
      </Link>
      <Link
        href="/admin/admins"
        className="text-ink transition-colors hover:text-dark-blue"
      >
        Admins
      </Link>
      <Link
        href="/dashboard"
        className="text-cool-gray transition-colors hover:text-maroon"
      >
        ← Dashboard
      </Link>
      <span
        className="text-xs italic text-cool-gray"
        title={teacherResult.teacher.email}
      >
        {teacherResult.teacher.display_name}
      </span>
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="text-xs italic text-cool-gray transition-colors hover:text-maroon"
        >
          Sign out
        </button>
      </form>
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <BrandHeader
        title="Oral Examiner"
        logoHref="/admin"
        ruleClassName="h-0.5 border-0 bg-dark-blue"
        right={nav}
      />

      <main className="flex-1 px-6 py-8">{children}</main>

      <footer className="border-t border-light-blue/40 bg-white/50 px-6 py-3 text-center text-xs italic text-cool-gray">
        Oral Examiner &middot; Admin &middot; Episcopal High School
      </footer>
    </div>
  );
}

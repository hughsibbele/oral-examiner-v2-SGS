import { redirect } from "next/navigation";
import Link from "next/link";
import { getTeacher } from "@/lib/auth/teacher";
import { isAdmin } from "@/lib/auth/admin";
import { BrandHeader } from "@/components/BrandHeader";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await getTeacher();
  if (!result) redirect("/login");

  const showAdminLink = await isAdmin();

  const nav = (
    <nav className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-sm">
      <Link
        href="/dashboard/agents"
        className="text-ink transition-colors hover:text-maroon"
      >
        Agents
      </Link>
      <Link
        href="/dashboard/canvas"
        className="text-ink transition-colors hover:text-maroon"
      >
        Setup
      </Link>
      {showAdminLink && (
        <Link
          href="/admin"
          className="rounded-sm border border-dark-blue/40 px-2 py-0.5 text-xs font-medium text-dark-blue transition-colors hover:bg-dark-blue hover:text-white"
          title="School-wide admin console"
        >
          Admin →
        </Link>
      )}
      <span
        className="text-xs italic text-cool-gray"
        title={result.teacher.email}
      >
        {result.teacher.display_name}
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
      <BrandHeader title="Oral Examiner" logoHref="/dashboard" right={nav} />

      <main className="flex-1 px-6 py-8">{children}</main>

      <footer className="border-t border-light-blue/40 bg-white/50 px-6 py-3 text-center text-xs italic text-cool-gray">
        Oral Examiner &middot; Episcopal High School
      </footer>
    </div>
  );
}

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

  // Self-bootstrap: if the admins table is empty and the current teacher's
  // email matches INITIAL_ADMIN_EMAIL, promote them. Idempotent — once any
  // admin exists, this never fires again.
  const bootstrap = await bootstrapAdminIfNeeded();

  const admin = await isAdmin();
  if (!admin) {
    return (
      <>
        <BrandHeader
          eyebrow="Episcopal High School"
          title="Oral Examiner — Admin"
          nav={
            <Link href="/dashboard" className="btn">
              Back to dashboard
            </Link>
          }
        />
        <main className="max-w-3xl mx-auto px-6 py-12">
          <h1 className="heading text-2xl mb-4">Admin access required</h1>
          <p className="text-sm leading-relaxed">
            This page is restricted to ecosystem admins. You&apos;re signed in as{" "}
            <span className="font-medium">{teacherResult.teacher.email}</span>.
          </p>
          {bootstrap.reason && (
            <p className="muted text-xs mt-4">Bootstrap diagnostic: {bootstrap.reason}</p>
          )}
        </main>
      </>
    );
  }

  return (
    <>
      <BrandHeader
        eyebrow="Episcopal High School"
        title="Oral Examiner — Admin"
        nav={
          <>
            <Link href="/admin">Overview</Link>
            <Link href="/admin/prompts">Prompts</Link>
            <Link href="/admin/admins">Admins</Link>
            <Link href="/dashboard">Dashboard</Link>
            <form action="/auth/signout" method="post" className="inline">
              <button type="submit" className="btn">
                Sign out
              </button>
            </form>
          </>
        }
      />
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </>
  );
}

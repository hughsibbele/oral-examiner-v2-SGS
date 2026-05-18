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

  return (
    <>
      <BrandHeader
        eyebrow="Episcopal High School"
        title="Oral Examiner"
        nav={
          <>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/dashboard/agents">Agent Templates</Link>
            <Link href="/dashboard/canvas">Canvas &amp; Drive setup</Link>
            {showAdminLink && <Link href="/admin">Admin</Link>}
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

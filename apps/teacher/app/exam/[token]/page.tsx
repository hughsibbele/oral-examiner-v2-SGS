import { BrandHeader } from "@/components/BrandHeader";

export default async function ExamPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <>
      <BrandHeader eyebrow="Episcopal High School" title="Oral Defense" />
      <main className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="heading text-2xl mb-3">Coming soon</h1>
        <p className="text-sm leading-relaxed">
          The student-facing exam flow is built in Phase C. This route exists
          so the auth callback&apos;s student-path branch (next prefix{" "}
          <code>/exam/</code>) has somewhere to land.
        </p>
        <p className="muted text-xs mt-6">
          Token: <code>{token}</code>
        </p>
      </main>
    </>
  );
}

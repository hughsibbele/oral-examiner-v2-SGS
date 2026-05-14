import { createServerSupabase } from "@/lib/supabase/server";

type PromptRow = {
  id: string;
  scope: string;
  purpose: string;
  key: string;
  body: string;
  version: number;
  updated_at: string;
  updated_by_email: string | null;
};

export default async function AdminPromptsPage() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("prompts")
    .select("*")
    .eq("scope", "system")
    .order("purpose");

  if (error) {
    return (
      <div className="surface p-5">
        <h1 className="heading text-2xl mb-2">Prompts</h1>
        <p className="text-sm">Failed to load prompts: {error.message}</p>
      </div>
    );
  }

  const prompts = (data ?? []) as unknown as PromptRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="heading text-2xl">System prompts</h1>
        <p className="muted text-sm mt-1">
          Edited here, executed in OE v2 at session-completion time. Super-grader
          mirrors these read-only via{" "}
          <code>GET /api/super-grader/prompts/&lt;key&gt;</code>.
        </p>
      </div>

      <div className="space-y-4">
        {prompts.map((p) => (
          <article key={p.id} className="surface p-5">
            <header className="flex items-baseline justify-between mb-3">
              <h2 className="heading text-lg">{p.purpose}</h2>
              <span className="muted text-xs">
                v{p.version} · updated {new Date(p.updated_at).toLocaleDateString()}
              </span>
            </header>
            <pre className="text-xs whitespace-pre-wrap font-mono bg-paper border border-rule rounded p-3 leading-relaxed">
              {p.body}
            </pre>
            <p className="muted text-xs mt-3">
              Editor UI ships in Phase D. For now, edit via SQL or the Supabase
              dashboard — the schema (scope + purpose + version) is final.
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

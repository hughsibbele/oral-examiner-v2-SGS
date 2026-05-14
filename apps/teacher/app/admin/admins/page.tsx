import { createServerSupabase } from "@/lib/supabase/server";

type AdminRow = {
  email: string;
  created_at: string;
  created_by_email: string | null;
};

export default async function AdminAdminsPage() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("admins")
    .select("*")
    .order("created_at");

  if (error) {
    return (
      <div className="surface p-5">
        <h1 className="heading text-2xl mb-2">Admins</h1>
        <p className="text-sm">Failed to load admins: {error.message}</p>
      </div>
    );
  }

  const admins = (data ?? []) as unknown as AdminRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="heading text-2xl">Admins</h1>
        <p className="muted text-sm mt-1">
          Ecosystem admins manage system prompts and retention sweeps. Self-bootstrap
          ran from <code>INITIAL_ADMIN_EMAIL</code> on first <code>/admin</code> visit.
        </p>
      </div>

      <div className="surface">
        <table className="w-full text-sm">
          <thead className="border-b border-rule">
            <tr>
              <th className="text-left p-3 font-medium">Email</th>
              <th className="text-left p-3 font-medium">Added</th>
              <th className="text-left p-3 font-medium">Added by</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.email} className="border-b border-rule last:border-0">
                <td className="p-3">{a.email}</td>
                <td className="p-3 muted">
                  {new Date(a.created_at).toLocaleDateString()}
                </td>
                <td className="p-3 muted">
                  {a.created_by_email ?? "self-bootstrap"}
                </td>
              </tr>
            ))}
            {admins.length === 0 && (
              <tr>
                <td colSpan={3} className="p-4 muted text-center text-xs">
                  No admins yet. Set <code>INITIAL_ADMIN_EMAIL</code> in the
                  env and sign in.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted text-xs">
        Add / revoke admin actions ship in Phase D. Last-admin-lockout
        protection is enforced at the server-action layer.
      </p>
    </div>
  );
}

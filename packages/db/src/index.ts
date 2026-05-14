/**
 * Supabase types — regenerated via the Supabase MCP and committed to
 * `generated.ts`. To refresh after a schema change:
 *
 *   pnpm --filter @oral-examiner/db gen-types
 *
 * (or via the Supabase MCP's `generate_typescript_types` tool, then paste).
 */

export type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
  CompositeTypes,
} from "./generated";
export { Constants } from "./generated";

import type { Database } from "./generated";

export type Insert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type Update<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

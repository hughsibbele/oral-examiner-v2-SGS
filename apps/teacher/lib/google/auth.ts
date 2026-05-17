// OAuth2 client per teacher, with automatic token refresh.
//
// Tokens are stored on teachers.google_{access,refresh}_token + expires_at
// from the /auth/callback handler. This helper:
//
// 1. Loads the row.
// 2. If the access token is within 5min of expiry (or already past),
//    refreshes via the googleapis SDK using the stored refresh_token.
// 3. Writes the new access_token + expires_at back to the DB.
// 4. Returns an OAuth2 client configured with the current credentials.
//
// Mirrors harkness-helper's pattern (apps/web/src/lib/google/auth.ts).

import { google, type Auth } from "googleapis";
import { createAdminClient } from "@/lib/supabase/admin";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export async function getTeacherGoogleClient(
  teacherId: string,
): Promise<Auth.OAuth2Client> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleAuthError(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.",
      "missing_oauth_config",
    );
  }

  const admin = createAdminClient();
  const { data: teacher, error } = await admin
    .from("teachers")
    .select(
      "google_access_token, google_refresh_token, google_token_expires_at",
    )
    .eq("id", teacherId)
    .maybeSingle();
  if (error) throw new GoogleAuthError(`teacher lookup: ${error.message}`);
  if (!teacher) throw new GoogleAuthError("Teacher not found.", "not_found");

  const expiry = teacher.google_token_expires_at
    ? new Date(teacher.google_token_expires_at).getTime()
    : 0;
  const accessValid =
    !!teacher.google_access_token && Date.now() + REFRESH_BUFFER_MS < expiry;

  // Need either a usable access_token OR a refresh_token. Without either, the
  // teacher must sign in again — Google won't issue a fresh refresh_token
  // without going through consent.
  if (!accessValid && !teacher.google_refresh_token) {
    throw new GoogleAuthError(
      "Google authorization expired. Sign out and sign in again to re-grant Drive access.",
      "missing_refresh_token",
    );
  }

  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({
    access_token: teacher.google_access_token ?? undefined,
    refresh_token: teacher.google_refresh_token ?? undefined,
    expiry_date: teacher.google_token_expires_at
      ? new Date(teacher.google_token_expires_at).getTime()
      : undefined,
  });

  if (!accessValid && teacher.google_refresh_token) {
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) {
      throw new GoogleAuthError("Token refresh returned no access_token.");
    }
    const newExpiresAt = credentials.expiry_date
      ? new Date(credentials.expiry_date).toISOString()
      : new Date(Date.now() + 55 * 60 * 1000).toISOString();
    await admin
      .from("teachers")
      .update({
        google_access_token: credentials.access_token,
        google_token_expires_at: newExpiresAt,
        // refresh_token rarely rotates; persist if it did
        ...(credentials.refresh_token
          ? { google_refresh_token: credentials.refresh_token }
          : {}),
      })
      .eq("id", teacherId);
    client.setCredentials(credentials);
  }

  return client;
}

/**
 * Get a fresh access_token for the teacher — useful for browser-side Drive
 * Picker that needs to authenticate the user without us exposing the
 * long-lived refresh_token. Refreshes if expiring soon.
 */
export async function getTeacherAccessToken(teacherId: string): Promise<{
  access_token: string;
  expires_at: string;
}> {
  const client = await getTeacherGoogleClient(teacherId);
  const creds = client.credentials;
  if (!creds.access_token) {
    throw new GoogleAuthError(
      "OAuth client has no access_token after refresh.",
      "no_access_token",
    );
  }
  return {
    access_token: creds.access_token,
    expires_at: creds.expiry_date
      ? new Date(creds.expiry_date).toISOString()
      : new Date(Date.now() + 55 * 60 * 1000).toISOString(),
  };
}

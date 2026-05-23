// OAuth2 client per teacher, with automatic token refresh.
//
// Tokens are stored encrypted on teachers.google_*_encrypted (M7.1 —
// AES-256-GCM via @oral-examiner/crypto, key TEACHER_GTOKEN_ENC_KEY).
// Legacy rows that pre-date M7.1 carry their tokens in
// `google_{access,refresh}_token` plaintext columns; this helper reads
// encrypted-first and falls back to the plaintext columns for those
// rows. On refresh, the new tokens are always encrypted-written +
// plaintext-nulled so the row converges to encrypted-only.
//
// 1. Loads the row.
// 2. Decrypts the access + refresh tokens (or reads legacy plaintext).
// 3. If the access token is within 5min of expiry (or already past),
//    refreshes via the googleapis SDK using the stored refresh_token.
// 4. Writes the new access_token (encrypted) + expires_at back to the
//    DB, nulling any legacy plaintext.
// 5. Returns an OAuth2 client configured with the current credentials.
//
// Mirrors harkness-helper's pattern (apps/web/src/lib/google/auth.ts).

import { google, type Auth } from "googleapis";
import { decryptSecret, encryptSecret } from "@oral-examiner/crypto";
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

function readGoogleTokenKeyFromEnv(): string {
  const key = process.env.TEACHER_GTOKEN_ENC_KEY;
  if (!key) {
    throw new GoogleAuthError(
      "TEACHER_GTOKEN_ENC_KEY env var is not set. Generate with " +
        '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"`.',
      "missing_token_key",
    );
  }
  return key;
}

/**
 * Read a token column with the encrypted-first / legacy-plaintext-fallback
 * shape. Returns null if neither column is populated. Throws if decryption
 * fails (tampered envelope, wrong key) — callers surface that as a 500
 * because a silent fallback to "use plaintext" would re-open the at-rest
 * leak M7.1 closes.
 */
function readEncryptedOrLegacy(
  encrypted: string | null,
  legacy: string | null,
  key: string,
): string | null {
  if (encrypted) return decryptSecret(encrypted, key);
  if (legacy) return legacy;
  return null;
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
      "google_access_token, google_refresh_token, google_access_token_encrypted, google_refresh_token_encrypted, google_token_expires_at",
    )
    .eq("id", teacherId)
    .maybeSingle();
  if (error) throw new GoogleAuthError(`teacher lookup: ${error.message}`);
  if (!teacher) throw new GoogleAuthError("Teacher not found.", "not_found");

  const key = readGoogleTokenKeyFromEnv();
  const accessToken = readEncryptedOrLegacy(
    teacher.google_access_token_encrypted,
    teacher.google_access_token,
    key,
  );
  const refreshToken = readEncryptedOrLegacy(
    teacher.google_refresh_token_encrypted,
    teacher.google_refresh_token,
    key,
  );

  const expiry = teacher.google_token_expires_at
    ? new Date(teacher.google_token_expires_at).getTime()
    : 0;
  const accessValid = !!accessToken && Date.now() + REFRESH_BUFFER_MS < expiry;

  // Need either a usable access_token OR a refresh_token. Without either, the
  // teacher must sign in again — Google won't issue a fresh refresh_token
  // without going through consent.
  if (!accessValid && !refreshToken) {
    throw new GoogleAuthError(
      "Google authorization expired. Sign out and sign in again to re-grant Drive access.",
      "missing_refresh_token",
    );
  }

  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({
    access_token: accessToken ?? undefined,
    refresh_token: refreshToken ?? undefined,
    expiry_date: teacher.google_token_expires_at
      ? new Date(teacher.google_token_expires_at).getTime()
      : undefined,
  });

  if (!accessValid && refreshToken) {
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) {
      throw new GoogleAuthError("Token refresh returned no access_token.");
    }
    const newExpiresAt = credentials.expiry_date
      ? new Date(credentials.expiry_date).toISOString()
      : new Date(Date.now() + 55 * 60 * 1000).toISOString();
    // Encrypt-on-write and null the plaintext columns so the row converges
    // to encrypted-only over time. M7.1.
    await admin
      .from("teachers")
      .update({
        google_access_token_encrypted: encryptSecret(
          credentials.access_token,
          key,
        ),
        google_access_token: null,
        google_token_expires_at: newExpiresAt,
        ...(credentials.refresh_token
          ? {
              google_refresh_token_encrypted: encryptSecret(
                credentials.refresh_token,
                key,
              ),
              google_refresh_token: null,
            }
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

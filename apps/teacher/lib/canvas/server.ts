import { decryptSecret, readKeyFromEnv } from "@oral-examiner/crypto";
import type { CanvasConfig } from "@oral-examiner/canvas";
import { getTeacher } from "@/lib/auth/teacher";

/**
 * Resolve a CanvasConfig for the currently-authed teacher.
 * Returns null if the teacher hasn't pasted a token yet, OR if the stored
 * token can't be decrypted (key rotated / corruption — surfaces as
 * "reconnect Canvas").
 */
export async function getCanvasConfigForTeacher(): Promise<{
  config: CanvasConfig;
  teacherId: string;
} | null> {
  const result = await getTeacher();
  if (!result) return null;

  const { teacher } = result;
  if (!teacher.canvas_token_encrypted || !teacher.canvas_host) return null;

  try {
    const token = decryptSecret(teacher.canvas_token_encrypted, readKeyFromEnv());
    return {
      config: { host: teacher.canvas_host, token },
      teacherId: teacher.id,
    };
  } catch {
    return null;
  }
}

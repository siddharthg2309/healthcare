import { createHash, randomBytes } from "node:crypto";
import { pool } from "@healthcare/database";

const reservationMinutes = 10;

function digestInviteCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export async function reserveInvitation(code: string, email: string): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `UPDATE invitations
     SET reservation_expires_at = now() + ($3::text || ' minutes')::interval
     WHERE token_hash = $1
       AND email = lower($2)
       AND redeemed_at IS NULL
       AND expires_at > now()
       AND (reservation_expires_at IS NULL OR reservation_expires_at < now())
     RETURNING id`,
    [digestInviteCode(code), email.trim(), String(reservationMinutes)],
  );
  return result.rows[0]?.id ?? null;
}

export async function releaseInvitation(invitationId: string): Promise<void> {
  await pool.query(
    `UPDATE invitations
     SET reservation_expires_at = NULL
     WHERE id = $1 AND redeemed_at IS NULL`,
    [invitationId],
  );
}

export async function redeemInvitation(invitationId: string, userId?: string): Promise<void> {
  await pool.query(
    `UPDATE invitations
     SET redeemed_at = now(), redeemed_by = $2, reservation_expires_at = NULL
     WHERE id = $1 AND redeemed_at IS NULL`,
    [invitationId, userId ?? null],
  );
}

export async function createInvitation(email: string, expiresInDays = 14): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await pool.query(
    `INSERT INTO invitations (token_hash, email, expires_at)
     VALUES ($1, lower($2), now() + ($3::text || ' days')::interval)`,
    [digestInviteCode(token), email.trim(), String(expiresInDays)],
  );
  return token;
}

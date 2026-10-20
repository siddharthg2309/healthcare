import { pool } from "@healthcare/database";
import type { PoolClient } from "pg";

export interface LeasedJob {
  id: string;
  user_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  lease_expires_at: Date;
}

async function withWorkerTransaction<T>(task: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.worker_access', 'true', true)");
    const result = await task(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimJobs(workerId: string, limit: number): Promise<LeasedJob[]> {
  return withWorkerTransaction(async (client) => {
    await client.query(
      `UPDATE job_queue
       SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
           last_error_code = 'lease_expired_max_attempts'
       WHERE status = 'leased' AND lease_expires_at < now() AND attempts >= max_attempts`,
    );

    const result = await client.query<LeasedJob>(
      `WITH candidates AS (
         SELECT id
         FROM job_queue
         WHERE attempts < max_attempts
           AND ((status = 'pending' AND available_at <= now())
             OR (status = 'leased' AND lease_expires_at < now()))
         ORDER BY available_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE job_queue AS jobs
       SET status = 'leased', attempts = jobs.attempts + 1,
           lease_owner = $2, lease_expires_at = now() + interval '5 minutes'
       FROM candidates
       WHERE jobs.id = candidates.id
       RETURNING jobs.id, jobs.user_id, jobs.kind, jobs.payload, jobs.attempts,
                 jobs.lease_expires_at`,
      [limit, workerId],
    );
    return result.rows;
  });
}

export async function completeJob(jobId: string, workerId: string): Promise<boolean> {
  return withWorkerTransaction(async (client) => {
    const result = await client.query(
      `UPDATE job_queue
       SET status = 'completed', completed_at = now(), lease_owner = NULL, lease_expires_at = NULL
       WHERE id = $1 AND status = 'leased' AND lease_owner = $2`,
      [jobId, workerId],
    );
    return result.rowCount === 1;
  });
}

export async function failJob(jobId: string, workerId: string, errorCode: string): Promise<boolean> {
  return withWorkerTransaction(async (client) => {
    const result = await client.query(
      `UPDATE job_queue
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
           available_at = now() + make_interval(secs => LEAST(3600, power(2, attempts)::integer * 30)),
           lease_owner = NULL, lease_expires_at = NULL, last_error_code = $3
       WHERE id = $1 AND status = 'leased' AND lease_owner = $2`,
      [jobId, workerId, errorCode.slice(0, 80)],
    );
    return result.rowCount === 1;
  });
}

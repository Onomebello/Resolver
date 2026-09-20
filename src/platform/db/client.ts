import { Pool } from "pg";
import { platformConfig } from "../config.js";

export const pool = new Pool({ connectionString: platformConfig.databaseUrl });

export interface UserRow {
  id: string;
  github_user_id: string;
  github_login: string;
  created_at: Date;
}

export interface InstallationRow {
  id: string;
  user_id: string;
  account_login: string;
  created_at: Date;
}

export interface AnthropicKeyRow {
  user_id: string;
  encrypted_key: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  updated_at: Date;
}

export interface RunRow {
  id: string;
  installation_id: string;
  repo_owner: string;
  repo_name: string;
  issue_number: number;
  status: "queued" | "running" | "succeeded" | "failed";
  pr_url: string | null;
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
}

export async function upsertUser(githubUserId: number, githubLogin: string): Promise<UserRow> {
  const { rows } = await pool.query<UserRow>(
    `insert into users (github_user_id, github_login)
     values ($1, $2)
     on conflict (github_user_id) do update set github_login = excluded.github_login
     returning *`,
    [githubUserId, githubLogin],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to upsert user");
  return row;
}

export async function getUserById(userId: string): Promise<UserRow | undefined> {
  const { rows } = await pool.query<UserRow>("select * from users where id = $1", [userId]);
  return rows[0];
}

export async function upsertInstallation(
  installationId: number,
  userId: string,
  accountLogin: string,
): Promise<void> {
  await pool.query(
    `insert into installations (id, user_id, account_login)
     values ($1, $2, $3)
     on conflict (id) do update set user_id = excluded.user_id, account_login = excluded.account_login`,
    [installationId, userId, accountLogin],
  );
}

export async function deleteInstallation(installationId: number): Promise<void> {
  await pool.query("delete from installations where id = $1", [installationId]);
}

export async function getInstallation(installationId: number): Promise<InstallationRow | undefined> {
  const { rows } = await pool.query<InstallationRow>("select * from installations where id = $1", [installationId]);
  return rows[0];
}

export async function listInstallationsForUser(userId: string): Promise<InstallationRow[]> {
  const { rows } = await pool.query<InstallationRow>(
    "select * from installations where user_id = $1 order by created_at desc",
    [userId],
  );
  return rows;
}

export async function setAnthropicKey(
  userId: string,
  encryptedKey: Buffer,
  iv: Buffer,
  authTag: Buffer,
): Promise<void> {
  await pool.query(
    `insert into anthropic_keys (user_id, encrypted_key, iv, auth_tag)
     values ($1, $2, $3, $4)
     on conflict (user_id) do update set encrypted_key = excluded.encrypted_key,
       iv = excluded.iv, auth_tag = excluded.auth_tag, updated_at = now()`,
    [userId, encryptedKey, iv, authTag],
  );
}

export async function getAnthropicKey(userId: string): Promise<AnthropicKeyRow | undefined> {
  const { rows } = await pool.query<AnthropicKeyRow>("select * from anthropic_keys where user_id = $1", [userId]);
  return rows[0];
}

export async function deleteAnthropicKey(userId: string): Promise<void> {
  await pool.query("delete from anthropic_keys where user_id = $1", [userId]);
}

export async function createRun(
  installationId: number,
  repoOwner: string,
  repoName: string,
  issueNumber: number,
): Promise<RunRow> {
  const { rows } = await pool.query<RunRow>(
    `insert into runs (installation_id, repo_owner, repo_name, issue_number, status)
     values ($1, $2, $3, $4, 'queued')
     returning *`,
    [installationId, repoOwner, repoName, issueNumber],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create run");
  return row;
}

export async function markRunStarted(runId: string): Promise<void> {
  await pool.query("update runs set status = 'running' where id = $1", [runId]);
}

export async function finishRun(
  runId: string,
  fields: { status: "succeeded" | "failed"; prUrl?: string; error?: string },
): Promise<void> {
  await pool.query(
    `update runs set status = $2, pr_url = coalesce($3, pr_url), error = coalesce($4, error), finished_at = now()
     where id = $1`,
    [runId, fields.status, fields.prUrl ?? null, fields.error ?? null],
  );
}

export async function listRunsForUser(userId: string, limit = 50): Promise<RunRow[]> {
  const { rows } = await pool.query<RunRow>(
    `select runs.* from runs
     join installations on installations.id = runs.installation_id
     where installations.user_id = $1
     order by runs.created_at desc
     limit $2`,
    [userId, limit],
  );
  return rows;
}

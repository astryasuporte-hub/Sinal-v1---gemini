/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR V2.4.1 — Distributed Lease Lock Service
 *
 * Trava distribuída persistente baseada em PostgreSQL (internal.distributed_job_locks),
 * compatível com PgBouncer Transaction Pooling (porta 6543) e Supabase Serverless.
 *
 * Política estrita: FAIL-CLOSED. Nunca faz fallback silencioso para Set/mutex em memória.
 */

import crypto from 'node:crypto';
import { executeSql, isPostgresConfigured } from './postgres.js';
import { getServerSupabase } from './db.js';

export class DistributedLockUnavailableError extends Error {
  public readonly code = 'LOCK_STORE_UNAVAILABLE';
  public readonly statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = 'DistributedLockUnavailableError';
  }
}

export interface DistributedLockHandle {
  acquired: boolean;
  lockKey: string;
  ownerId: string;
  expiresAt?: string;
  release: () => Promise<void>;
  renew: () => Promise<boolean>;
}

export interface DistributedLockDeps {
  executeSql: typeof executeSql;
  isPostgresConfigured: typeof isPostgresConfigured;
  getServerSupabase: typeof getServerSupabase;
}

let customLockDeps: DistributedLockDeps | null = null;

export function setDistributedLockTestDeps(deps: Partial<DistributedLockDeps> | null): void {
  if (!deps) {
    customLockDeps = null;
    return;
  }
  customLockDeps = {
    executeSql: deps.executeSql || executeSql,
    isPostgresConfigured: deps.isPostgresConfigured || isPostgresConfigured,
    getServerSupabase: deps.getServerSupabase || getServerSupabase,
  };
}

function getLockDeps(override?: Partial<DistributedLockDeps>): DistributedLockDeps {
  return {
    executeSql: override?.executeSql || customLockDeps?.executeSql || executeSql,
    isPostgresConfigured: override?.isPostgresConfigured || customLockDeps?.isPostgresConfigured || isPostgresConfigured,
    getServerSupabase: override?.getServerSupabase || customLockDeps?.getServerSupabase || getServerSupabase,
  };
}

function normalizeErrorMessage(err: any): string {
  return String(err?.message || err || 'Erro desconhecido ao acessar lock distribuído').trim();
}

export async function acquireDistributedLeaseLock(options: {
  lockKey: string;
  ttlMs?: number;
  heartbeatIntervalMs?: number;
  metadata?: Record<string, any>;
  deps?: Partial<DistributedLockDeps>;
}): Promise<DistributedLockHandle> {
  const lockKey = String(options.lockKey || '').trim();
  if (!lockKey) {
    throw new DistributedLockUnavailableError('LOCK_STORE_UNAVAILABLE: lockKey vazio.');
  }

  const ttlMs = Math.max(1000, Math.min(86_400_000, Number(options.ttlMs ?? 300_000)));
  const ownerId = `worker_${crypto.randomUUID()}`;
  const metadataJson = JSON.stringify(options.metadata || {});
  const deps = getLockDeps(options.deps);

  let acquireResult: any = null;
  let lastError: any = null;

  if (deps.isPostgresConfigured()) {
    try {
      const pgRes = await deps.executeSql(
        `SELECT public.acquire_distributed_job_lock($1, $2, $3, $4::jsonb) AS result`,
        [lockKey, ownerId, ttlMs, metadataJson]
      );
      acquireResult = pgRes?.rows?.[0]?.result ?? null;
    } catch (err: any) {
      lastError = err;
    }
  }

  if (!acquireResult) {
    try {
      const supabase = deps.getServerSupabase() as any;
      if (supabase && typeof supabase.rpc === 'function') {
        const rpcRes = await supabase.rpc('acquire_distributed_job_lock', {
          p_lock_key: lockKey,
          p_owner_id: ownerId,
          p_ttl_ms: ttlMs,
          p_metadata: options.metadata || {},
        });
        if (rpcRes?.error) {
          lastError = rpcRes.error;
        } else if (rpcRes?.data && typeof rpcRes.data.acquired === 'boolean') {
          acquireResult = rpcRes.data;
        } else {
          lastError = new Error('RPC acquire_distributed_job_lock retornou resposta inválida.');
        }
      } else if (!lastError) {
        lastError = new Error('Nenhum backend persistente de lock distribuído (PostgreSQL ou Supabase RPC) disponível.');
      }
    } catch (err: any) {
      lastError = err;
    }
  }

  if (!acquireResult || typeof acquireResult.acquired !== 'boolean') {
    throw new DistributedLockUnavailableError(
      `Lock distribuído indisponível (fail-closed): ${normalizeErrorMessage(lastError)}`
    );
  }

  if (!acquireResult.acquired) {
    return {
      acquired: false,
      lockKey,
      ownerId: String(acquireResult.owner_id || ''),
      expiresAt: acquireResult.expires_at ? String(acquireResult.expires_at) : undefined,
      release: async () => {},
      renew: async () => false,
    };
  }

  let released = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const renew = async (): Promise<boolean> => {
    if (released) return false;
    if (deps.isPostgresConfigured()) {
      try {
        const res = await deps.executeSql(
          `SELECT public.renew_distributed_job_lock($1, $2, $3) AS result`,
          [lockKey, ownerId, ttlMs]
        );
        return Boolean(res?.rows?.[0]?.result?.renewed);
      } catch {
        return false;
      }
    }
    try {
      const supabase = deps.getServerSupabase() as any;
      if (supabase && typeof supabase.rpc === 'function') {
        const rpcRes = await supabase.rpc('renew_distributed_job_lock', {
          p_lock_key: lockKey,
          p_owner_id: ownerId,
          p_ttl_ms: ttlMs,
        });
        return Boolean(!rpcRes?.error && rpcRes?.data?.renewed);
      }
    } catch {}
    return false;
  };

  const intervalMs = Math.max(
    500,
    Number(options.heartbeatIntervalMs ?? Math.min(30_000, Math.floor(ttlMs / 3)))
  );
  if (intervalMs < ttlMs) {
    heartbeatTimer = setInterval(() => {
      void renew();
    }, intervalMs);
    if (typeof (heartbeatTimer as any).unref === 'function') {
      (heartbeatTimer as any).unref();
    }
  }

  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    if (deps.isPostgresConfigured()) {
      try {
        await deps.executeSql(`SELECT public.release_distributed_job_lock($1, $2)`, [lockKey, ownerId]);
        return;
      } catch {}
    }
    try {
      const supabase = deps.getServerSupabase() as any;
      if (supabase && typeof supabase.rpc === 'function') {
        await supabase.rpc('release_distributed_job_lock', {
          p_lock_key: lockKey,
          p_owner_id: ownerId,
        });
      }
    } catch {}
  };

  return {
    acquired: true,
    lockKey,
    ownerId,
    expiresAt: acquireResult.expires_at ? String(acquireResult.expires_at) : undefined,
    release,
    renew,
  };
}

export async function listActiveDistributedLocks(
  overrideDeps?: Partial<DistributedLockDeps>
): Promise<Array<{ lockKey: string; expiresAt: string; heartbeatAt: string }>> {
  const deps = getLockDeps(overrideDeps);

  if (deps.isPostgresConfigured()) {
    try {
      const res = await deps.executeSql(
        `SELECT lock_key, expires_at, heartbeat_at
           FROM internal.distributed_job_locks
          WHERE expires_at > pg_catalog.clock_timestamp()
          ORDER BY acquired_at DESC`
      );
      return (res.rows || []).map((r: any) => ({
        lockKey: String(r.lock_key),
        expiresAt: new Date(r.expires_at).toISOString(),
        heartbeatAt: new Date(r.heartbeat_at).toISOString(),
      }));
    } catch {
      return [];
    }
  }

  try {
    const supabase = deps.getServerSupabase() as any;
    if (supabase && typeof supabase.rpc === 'function') {
      const res = await supabase.rpc('get_briefing_ops_metrics');
      const locks = res?.data?.activeLocks;
      if (Array.isArray(locks)) {
        return locks.map((l: any) => ({
          lockKey: String(l.lockKey),
          expiresAt: String(l.expiresAt),
          heartbeatAt: String(l.heartbeatAt),
        }));
      }
    }
  } catch {}

  return [];
}

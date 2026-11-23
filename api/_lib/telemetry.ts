/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Telemetria Leve & Rastreamento Distribuído (W3C Trace Context + Server-Timing).
 * Zero PII: nunca registra e-mails, tokens, cookies, IPs crus ou payloads de usuário.
 */

import crypto from 'node:crypto';

export interface TelemetrySpan {
  name: string;
  durationMs: number;
  status: 'ok' | 'error';
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  requestId: string;
  startMs: number;
  spans: TelemetrySpan[];
}

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i;

function sanitizeHeaderValue(val: unknown): string {
  return String(val || '').replace(/[\r\n]/g, '').trim();
}

export function createTraceContext(req?: { headers?: Record<string, any> }): TraceContext {
  const headers = req?.headers || {};
  const rawTraceParent = sanitizeHeaderValue(headers['traceparent']);
  const tpMatch = rawTraceParent.match(TRACEPARENT_RE);
  const rawReqId = sanitizeHeaderValue(headers['x-request-id']);

  const traceId = tpMatch ? tpMatch[1].toLowerCase() : crypto.randomBytes(16).toString('hex');
  const spanId = crypto.randomBytes(8).toString('hex');
  const requestId = SAFE_ID_RE.test(rawReqId) ? rawReqId : traceId.slice(0, 16);

  return {
    traceId,
    spanId,
    requestId,
    startMs: performance.now(),
    spans: [],
  };
}

export async function withSpan<T>(
  ctx: TraceContext | null | undefined,
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const cleanName = name.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 40) || 'op';
  const t0 = performance.now();
  try {
    const out = await fn();
    if (ctx) {
      ctx.spans.push({
        name: cleanName,
        durationMs: Math.round((performance.now() - t0) * 100) / 100,
        status: 'ok',
      });
    }
    return out;
  } catch (err) {
    if (ctx) {
      ctx.spans.push({
        name: cleanName,
        durationMs: Math.round((performance.now() - t0) * 100) / 100,
        status: 'error',
      });
    }
    throw err;
  }
}

export function buildServerTimingHeader(ctx: TraceContext): string {
  const totalMs = Math.round((performance.now() - ctx.startMs) * 100) / 100;
  const parts = ctx.spans.map((s) => `${s.name};dur=${s.durationMs}`);
  parts.push(`total;dur=${totalMs}`);
  return parts.join(', ');
}

export function attachTelemetryHeaders(res: any, ctx: TraceContext): void {
  if (!res || typeof res.setHeader !== 'function') return;
  try {
    res.setHeader('X-Request-Id', ctx.requestId);
    res.setHeader('Traceparent', `00-${ctx.traceId}-${ctx.spanId}-01`);
    res.setHeader('Server-Timing', buildServerTimingHeader(ctx));
  } catch {}
}

export function computeWeakEtag(input: string): string {
  const hash = crypto.createHash('sha1').update(input).digest('base64url').slice(0, 16);
  return `W/"${hash}"`;
}

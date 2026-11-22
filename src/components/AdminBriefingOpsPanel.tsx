/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  Users
} from 'lucide-react';
import { adminService, BriefingOpsSnapshotDto } from '../services/adminService';

const STATUS_BADGE_MAP: Record<string, { label: string; cls: string }> = {
  READY: { label: 'READY', cls: 'bg-zinc-800 text-zinc-100 border-zinc-600' },
  SENT: { label: 'SENT', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  FAILED: { label: 'FAILED', cls: 'bg-red-500/15 text-red-300 border-red-500/40' },
  GENERATING: { label: 'GENERATING', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  PENDING: { label: 'PENDING', cls: 'bg-zinc-900 text-zinc-400 border-zinc-700' },
  CANCELED: { label: 'CANCELED', cls: 'bg-zinc-900 text-zinc-500 border-zinc-800' },
};

export const AdminBriefingOpsPanel: React.FC = () => {
  const [snapshot, setSnapshot] = useState<BriefingOpsSnapshotDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await adminService.getBriefingOperationsSnapshot();
    if (!res.success || !res.snapshot) {
      setError(res.error || 'Não foi possível carregar os dados operacionais.');
      setLoading(false);
      return;
    }
    setSnapshot(res.snapshot);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  return (
    <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#182136]">
        <div>
          <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Monitoramento Operacional — Briefings, Agendamento & Notificações</span>
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Histórico real de edições, falhas, horários elegíveis e alertas processados (sem exposição de e-mails ou PII).
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadSnapshot()}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl bg-[#141a2b] hover:bg-[#1a2238] border border-[#24304d] text-xs font-semibold text-zinc-100 inline-flex items-center gap-2 cursor-pointer transition disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Atualizando...' : 'Atualizar Telemetria'}</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-950/30 border border-red-800/50 text-xs text-red-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {snapshot && (
        <>
          {/* Indicadores Principais */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-[#0a0e17] border border-[#182136] space-y-1">
              <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-zinc-400" />
                <span>Briefings (Sent / Ready)</span>
              </div>
              <div className="text-lg font-bold text-white font-mono tabular-nums">
                {snapshot.briefingsSummary.byStatus.SENT} / {snapshot.briefingsSummary.byStatus.READY}
              </div>
              <div className="text-[11px] text-zinc-500 font-mono tabular-nums">
                Total: {snapshot.briefingsSummary.total} · Falhas: {snapshot.briefingsSummary.byStatus.FAILED}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#0a0e17] border border-[#182136] space-y-1">
              <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                <Bell className="w-3.5 h-3.5 text-zinc-400" />
                <span>Notificações Processadas</span>
              </div>
              <div className="text-lg font-bold text-white font-mono tabular-nums">
                {snapshot.notificationsSummary.totalProcessed}
              </div>
              <div className="text-[11px] text-zinc-500 font-mono tabular-nums">
                Não lidas: {snapshot.notificationsSummary.unreadTotal} · Briefings: {snapshot.notificationsSummary.briefingReadyCount}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#0a0e17] border border-[#182136] space-y-1">
              <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-zinc-400" />
                <span>Destinatários Elegíveis</span>
              </div>
              <div className="text-lg font-bold text-white font-mono tabular-nums">
                {snapshot.schedulesSummary.recipientsWithEmailCount}
              </div>
              <div className="text-[11px] text-zinc-500 font-mono tabular-nums">
                Manhã: {snapshot.schedulesSummary.eligibleMorningUsers} · Noite: {snapshot.schedulesSummary.eligibleEveningUsers}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#0a0e17] border border-[#182136] space-y-1">
              <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />
                <span>Prontidão do Ambiente</span>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${snapshot.environment.resendConfigured ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}>
                  {snapshot.environment.resendConfigured ? 'RESEND OK' : 'SEM RESEND_KEY'}
                </span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${snapshot.environment.cronSecretConfigured ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>
                  {snapshot.environment.cronSecretConfigured ? 'CRON_SECRET OK' : 'SEM CRON_SECRET'}
                </span>
              </div>
              <div className="text-[10px] text-zinc-500 font-mono flex items-center gap-1 pt-0.5">
                <Lock className="w-3 h-3" />
                <span>Locks ativos: {snapshot.environment.activeLocks.length}</span>
              </div>
            </div>
          </div>

          {/* Histórico de Briefings Persistidos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-[#0a0e17] border border-[#182136] space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Últimas Edições Persistidas (DB)</span>
                </h4>
                <span className="text-[10px] font-mono text-zinc-500">
                  MORNING {snapshot.briefingsSummary.byType.MORNING} · EVENING {snapshot.briefingsSummary.byType.EVENING}
                </span>
              </div>

              {snapshot.recentBriefings.length === 0 ? (
                <p className="text-xs text-zinc-500 py-4 text-center">
                  Nenhum briefing gerado ainda neste ambiente.
                </p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {snapshot.recentBriefings.map((b) => {
                    const badge = STATUS_BADGE_MAP[b.status] || STATUS_BADGE_MAP.PENDING;
                    return (
                      <div
                        key={b.id}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#111625] border border-[#1a2236] text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-200">
                            <span className="font-bold">{b.type}</span>
                            <span className="text-zinc-500">{b.localDate || 'sem data'}</span>
                            <span className="text-zinc-500">{b.userMask}</span>
                          </div>
                          <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                            {b.sentAt
                              ? `Enviado: ${new Date(b.sentAt).toLocaleString('pt-BR')}`
                              : b.scheduledFor
                                ? `Agendado: ${new Date(b.scheduledFor).toLocaleString('pt-BR')}`
                                : ''}
                          </div>
                        </div>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border shrink-0 ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Logs Sanitizados de Execução do Motor */}
            <div className="p-4 rounded-xl bg-[#0a0e17] border border-[#182136] space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Histórico de Execuções do Motor</span>
                </h4>
                <span className="text-[10px] font-mono text-zinc-500">
                  Cron prod briefing: aguardando validação
                </span>
              </div>

              {snapshot.recentRunLogs.length === 0 ? (
                <p className="text-xs text-zinc-500 py-4 text-center">
                  Nenhuma execução registrada nesta instância desde a inicialização.
                </p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {snapshot.recentRunLogs.map((log) => (
                    <div
                      key={log.runId}
                      className="p-2.5 rounded-lg bg-[#111625] border border-[#1a2236] text-[11px] font-mono space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2 text-zinc-200">
                        <span>
                          {log.type} · {log.mode} · {log.localDate}
                        </span>
                        <span className="text-zinc-400">{log.durationMs}ms</span>
                      </div>
                      <div className="text-zinc-400 flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>Elegíveis: {log.eligibleUsers}</span>
                        <span>Ready: {log.ready}</span>
                        <span>Sent: {log.sent}</span>
                        <span>Dup: {log.skippedDuplicates}</span>
                        <span>Falhas: {log.failed}</span>
                        {log.locked && <span className="text-amber-300">LOCKED</span>}
                      </div>
                      {log.error && (
                        <div className="text-red-300 text-[10px] break-all">{log.error}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

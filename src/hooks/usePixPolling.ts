/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { zynpayService, ZynPayCharge } from '../services/zynpayService';

export interface UsePixPollingOptions {
  chargeId: string | null | undefined;
  enabled?: boolean;
  intervalMs?: number; // Padrão: 5000ms (5 segundos conforme especificado)
  onSuccess?: (charge: ZynPayCharge) => void;
  onError?: (error: string) => void;
}

export interface UsePixPollingResult {
  charge: ZynPayCharge | null;
  isPolling: boolean;
  status: 'IDLE' | 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  checkNow: () => Promise<void>;
  stop: () => void;
}

/**
 * Hook de polling que consulta o status da cobrança Pix a cada 5 segundos
 * até que o status seja alterado para 'PAID' pelo backend da ZynPay.
 */
export function usePixPolling({
  chargeId,
  enabled = true,
  intervalMs = 5000,
  onSuccess,
  onError
}: UsePixPollingOptions): UsePixPollingResult {
  const [charge, setCharge] = useState<ZynPayCharge | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [status, setStatus] = useState<'IDLE' | 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED'>('IDLE');

  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const timerRef = useRef<any>(null);
  const isStoppedRef = useRef<boolean>(false);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  }, [onSuccess, onError]);

  const checkStatus = useCallback(async () => {
    if (!chargeId || isStoppedRef.current) return;

    try {
      const res = await zynpayService.getChargeStatus(chargeId);
      if (res.success && res.charge) {
        setCharge(res.charge);
        setStatus(res.charge.status);

        if (res.charge.status === 'PAID') {
          // Status alterado para 'PAID' pelo backend: interrompe polling imediatamente
          isStoppedRef.current = true;
          setIsPolling(false);
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }

          // Atualiza automaticamente o status da assinatura no localStorage do front-end
          try {
            localStorage.setItem('fatosbr_pro_active', 'true');
            const currentSub = localStorage.getItem('sinal_subscription');
            if (currentSub) {
              const parsed = JSON.parse(currentSub);
              parsed.status = 'ACTIVE';
              parsed.planName = 'FatosBR Pro (Ativo)';
              localStorage.setItem('sinal_subscription', JSON.stringify(parsed));
            }
            window.dispatchEvent(new CustomEvent('fatosbr_subscription_updated', {
              detail: { status: 'ACTIVE', chargeId, timestamp: new Date().toISOString() }
            }));
          } catch (storageErr) {
            console.error('[usePixPolling] Falha ao atualizar localStorage:', storageErr);
          }

          onSuccessRef.current?.(res.charge);
        } else if (res.charge.status === 'EXPIRED' || res.charge.status === 'CANCELLED') {
          isStoppedRef.current = true;
          setIsPolling(false);
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }
      } else if (res.error) {
        onErrorRef.current?.(res.error);
      }
    } catch (err: any) {
      onErrorRef.current?.(err.message || 'Erro ao consultar status Pix');
    }
  }, [chargeId]);

  const stop = useCallback(() => {
    isStoppedRef.current = true;
    setIsPolling(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!chargeId || !enabled) {
      stop();
      return;
    }

    isStoppedRef.current = false;
    setIsPolling(true);
    setStatus('PENDING');

    // Primeira verificação imediata
    checkStatus();

    // Loop de polling a cada 5 segundos (5000ms)
    timerRef.current = setInterval(() => {
      checkStatus();
    }, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [chargeId, enabled, intervalMs, checkStatus, stop]);

  return {
    charge,
    isPolling,
    status,
    checkNow: checkStatus,
    stop
  };
}

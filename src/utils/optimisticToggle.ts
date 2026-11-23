/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Executa mutação otimista imediatamente e reverte automaticamente caso a persistência
 * remota falhe ou retorne resultado divergente do estado esperado.
 */
export async function runOptimisticMutation(params: {
  previousState: boolean;
  applyOptimistic: (nextValue: boolean) => void;
  persist: () => Promise<boolean>;
  onRollback?: () => void;
}): Promise<{ ok: boolean; finalState: boolean }> {
  const targetState = !params.previousState;
  params.applyOptimistic(targetState);

  try {
    const persistedState = await params.persist();
    if (persistedState !== targetState) {
      params.applyOptimistic(params.previousState);
      params.onRollback?.();
      return { ok: false, finalState: params.previousState };
    }
    return { ok: true, finalState: targetState };
  } catch {
    params.applyOptimistic(params.previousState);
    params.onRollback?.();
    return { ok: false, finalState: params.previousState };
  }
}

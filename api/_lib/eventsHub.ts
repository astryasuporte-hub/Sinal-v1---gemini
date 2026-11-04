/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Server-Side Event Hub for Real-time SSE Billing Notifications
 */

type SSEListener = (data: any) => void;

const listeners = new Set<SSEListener>();

export function subscribeBillingEvents(listener: SSEListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function broadcastBillingEvent(data: any): void {
  for (const listener of listeners) {
    try {
      listener(data);
    } catch {}
  }
}

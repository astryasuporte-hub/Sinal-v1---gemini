/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Event } from '../types/sinal';

const PUSH_PREF_KEY = 'sinal_push_notifications_enabled';

class NotificationService {
  private permission: NotificationPermission = 'default';
  private swRegistration: ServiceWorkerRegistration | null = null;
  private isSwRegistering = false;

  constructor() {
    if (typeof window !== 'undefined') {
      if ('Notification' in window) {
        this.permission = Notification.permission;
      }
      this.initServiceWorker();
    }
  }

  /**
   * Inicializa o Service Worker para garantir suporte ao Web Push mesmo com a aplicação em segundo plano
   */
  public async initServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return null;
    }

    if (this.swRegistration) {
      return this.swRegistration;
    }

    if (this.isSwRegistering) {
      try {
        return await navigator.serviceWorker.ready;
      } catch {
        return null;
      }
    }

    this.isSwRegistering = true;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      this.swRegistration = reg;
      console.log('[FatosBR] Service Worker registrado para Web Push em segundo plano:', reg.scope);
      return reg;
    } catch (err) {
      console.warn('[FatosBR] Registro de Service Worker indisponível:', err);
      try {
        const ready = await navigator.serviceWorker.ready;
        this.swRegistration = ready;
        return ready;
      } catch {
        return null;
      }
    } finally {
      this.isSwRegistering = false;
    }
  }

  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  public isServiceWorkerSupported(): boolean {
    return typeof window !== 'undefined' && 'serviceWorker' in navigator;
  }

  public getPermission(): NotificationPermission {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      this.permission = Notification.permission;
    }
    return this.permission;
  }

  public isEnabled(): boolean {
    if (!this.isSupported()) return false;
    const pref = typeof window !== 'undefined' ? localStorage.getItem(PUSH_PREF_KEY) : null;
    return this.getPermission() === 'granted' && pref !== 'false';
  }

  public async requestPermission(): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      const result = await Notification.requestPermission();
      this.permission = result;
      if (result === 'granted') {
        localStorage.setItem(PUSH_PREF_KEY, 'true');
        await this.initServiceWorker();
        return true;
      }
      return false;
    } catch (err) {
      console.warn('Erro ao solicitar permissão de notificações:', err);
      return false;
    }
  }

  public setEnabled(enabled: boolean): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(PUSH_PREF_KEY, String(enabled));
    }
  }

  private inAppListeners: Set<(payload: { id: string; title: string; summary: string; category?: string; timestamp?: string; event?: Event }) => void> = new Set();

  public subscribeInAppPush(listener: (payload: { id: string; title: string; summary: string; category?: string; timestamp?: string; event?: Event }) => void): () => void {
    this.inAppListeners.add(listener);
    return () => {
      this.inAppListeners.delete(listener);
    };
  }

  public triggerInAppPush(payload: { id: string; title: string; summary: string; category?: string; timestamp?: string; event?: Event }): void {
    this.inAppListeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (e) {
        console.warn('Erro ao notificar listener in-app:', e);
      }
    });
  }

  /**
   * Dispara uma notificação nativa e o banner editorial in-app para acontecimentos de alta relevância (Breaking News).
   * Se o Service Worker estiver pronto, usa showNotification para alertar o usuário mesmo com a aba em segundo plano!
   */
  public async sendBreakingNewsNotification(event: Event, onClick?: () => void): Promise<boolean> {
    // 1. Dispara o banner editorial in-app para visualização enquanto navega
    this.triggerInAppPush({
      id: event.id,
      title: event.title,
      summary: event.summary || 'Acontecimento com alta repercussão identificado nos principais veículos.',
      category: (event.category || 'URGENTE').toUpperCase(),
      timestamp: event.relativeTime || 'Agora',
      event
    });

    if (!this.isEnabled()) return true;

    const title = `FatosBR • ${(event.category || 'URGENTE').toUpperCase()}: ${event.title}`;
    const body = event.summary
      ? (event.summary.length > 130 ? `${event.summary.slice(0, 130)}...` : event.summary)
      : 'Novo acontecimento crítico apurado no FatosBR.';

    // 2. Disparo via ServiceWorker showNotification (funciona com o app em segundo plano)
    try {
      const reg = this.swRegistration || (await this.initServiceWorker());
      if (reg && 'showNotification' in reg) {
        await reg.showNotification(title, {
          body,
          icon: '/pwa-icon-192.png',
          badge: '/logo-fatosbr.svg',
          tag: `fatosbr-event-${event.id}`,
          data: {
            url: `/?event=${event.id}`,
            eventId: event.id
          },
          vibrate: [200, 100, 200],
          requireInteraction: true
        } as any);
        return true;
      }
    } catch (swErr) {
      console.warn('Falha no showNotification via Service Worker, usando fallback nativo:', swErr);
    }

    // 3. Fallback para Notification API nativa da janela
    try {
      const notification = new Notification(title, {
        body,
        icon: '/pwa-icon-192.png',
        tag: `fatosbr-event-${event.id}`
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
        if (onClick) {
          onClick();
        }
      };

      return true;
    } catch (err) {
      console.warn('Falha ao emitir notificação nativa:', err);
      return false;
    }
  }

  /**
   * Dispara um teste de notificação push em segundo plano
   */
  public async triggerTestNotification(customTitle?: string, customBody?: string): Promise<boolean> {
    const title = customTitle || 'FatosBR • URGENTE: Novo marco regulatório aprovado';
    const body = customBody || 'Alerta de Breaking News monitorado pelo FatosBR em tempo real.';

    this.triggerInAppPush({
      id: `test-${Date.now()}`,
      title,
      summary: body,
      category: 'URGENTE',
      timestamp: 'Agora'
    });

    if (!this.isEnabled()) return false;

    try {
      const reg = this.swRegistration || (await this.initServiceWorker());
      if (reg && 'showNotification' in reg) {
        await reg.showNotification(title, {
          body,
          icon: '/pwa-icon-192.png',
          badge: '/logo-fatosbr.svg',
          tag: `test-${Date.now()}`,
          data: { url: '/' },
          vibrate: [200, 100, 200]
        } as any);
        return true;
      } else {
        new Notification(title, { body, icon: '/pwa-icon-192.png' });
        return true;
      }
    } catch (err) {
      console.warn('Erro ao emitir push de teste:', err);
      return false;
    }
  }
}

export const notificationService = new NotificationService();

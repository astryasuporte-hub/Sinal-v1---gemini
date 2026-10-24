/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Event } from '../types/sinal';

const PUSH_PREF_KEY = 'sinal_push_notifications_enabled';

class NotificationService {
  private permission: NotificationPermission = 'default';

  constructor() {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      this.permission = Notification.permission;
    }
  }

  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
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
   * Dispara uma notificação nativa e o banner editorial in-app para acontecimentos de alta relevância (Breaking News)
   */
  public sendBreakingNewsNotification(event: Event, onClick?: () => void): boolean {
    // 1. Dispara o banner editorial P&B in-app em qualquer circunstância
    this.triggerInAppPush({
      id: event.id,
      title: event.title,
      summary: event.summary || 'Acontecimento com alta repercussão identificado nos principais veículos.',
      category: event.category.toUpperCase(),
      timestamp: event.relativeTime || 'Agora',
      event
    });

    if (!this.isEnabled()) return true;

    // 2. Dispara notificação nativa do navegador
    try {
      const title = `FatosBR • ${event.category.toUpperCase()}: ${event.title}`;
      const body = event.summary ? (event.summary.length > 130 ? `${event.summary.slice(0, 130)}...` : event.summary) : 'Novo acontecimento crítico apurado no FatosBR.';
      
      const notification = new Notification(title, {
        body,
        icon: '/favicon.ico',
        tag: `fatosbr-event-${event.id}`,
        silent: true // Mantemos silencioso nativamente para usar o áudio harmonioso do soundAlertService
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
      return true;
    }
  }

  /**
   * Dispara uma notificação de teste editorial para validação no front-end
   */
  public triggerTestNotification(customTitle?: string): void {
    this.triggerInAppPush({
      id: `test-${Date.now()}`,
      title: customTitle || 'Banco Central anuncia nova diretriz cambial em alinhamento ao Tesouro',
      summary: 'Medida busca estabilizar volatilidade nas cotações e atrair capital de longo prazo para títulos soberanos.',
      category: 'ECONOMIA',
      timestamp: 'Agora'
    });
  }
}

export const notificationService = new NotificationService();

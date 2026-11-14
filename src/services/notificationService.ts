/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Event } from '../types/sinal';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

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

  private pushSubscription: PushSubscription | null = null;

  /**
   * Inicializa o Service Worker com suporte a Firebase Cloud Messaging e Web Push API mesmo com navegador fechado
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
      // Prioriza o service worker do Firebase Messaging para push em segundo plano
      let reg: ServiceWorkerRegistration;
      try {
        reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
      } catch {
        reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      }
      this.swRegistration = reg;
      console.log('[FatosBR] Firebase & Web Push Service Worker ativo:', reg.scope);

      // Tenta recuperar inscrição Web Push existente
      if ('pushManager' in reg) {
        reg.pushManager.getSubscription().then((sub) => {
          this.pushSubscription = sub;
          if (sub) {
            this.syncPushSubscriptionToServer(sub);
          }
        }).catch(() => {});
      }

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

  /**
   * Cria ou renova a inscrição Web Push com o PushManager para alertas com o navegador fechado
   */
  public async subscribeWebPush(userEmail?: string): Promise<boolean> {
    try {
      const reg = this.swRegistration || (await this.initServiceWorker());
      if (!reg || !('pushManager' in reg)) return false;

      // Chave pública VAPID padrão para Web Push
      const applicationServerKey = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey
        }).catch(() => null);
      }

      if (sub) {
        this.pushSubscription = sub;
        await this.syncPushSubscriptionToServer(sub, userEmail);
        localStorage.setItem('fatosbr_webpush_subscribed', 'true');
        return true;
      }
    } catch (e) {
      console.warn('[notificationService] Web Push Subscription info:', e);
    }
    return false;
  }

  /**
   * Sincroniza o endpoint do Web Push com o backend
   */
  private async syncPushSubscriptionToServer(sub: PushSubscription, userEmail?: string): Promise<void> {
    try {
      await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          userEmail: userEmail || 'leitor@fatosbr.com.br',
          subscribedAt: new Date().toISOString()
        })
      }).catch(() => {});
    } catch {}
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

  /**
   * Envia alerta de Breaking News para todos os dispositivos inscritos via Web Push (funciona mesmo com navegador fechado)
   */
  public async broadcastBreakingNewsPush(event: Event): Promise<boolean> {
    try {
      await fetch('/api/notifications/broadcast-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `FatosBR • ${(event.category || 'URGENTE').toUpperCase()}: ${event.title}`,
          body: event.summary || 'Acontecimento urgente consolidado pela inteligência analítica do FatosBR.',
          url: `/?event=${encodeURIComponent(event.id)}`,
          eventId: event.id,
          tag: `fatosbr-push-${event.id}`,
          timestamp: new Date().toISOString()
        })
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Obtém chave de cache privada para notificações de um usuário específico
   */
  public getUserCacheKey(userId: string): string {
    return `fatosbr_notifs_cache_${userId}`;
  }

  /**
   * Limpa cache de notificações de um usuário (usado no logout)
   */
  public clearUserCache(userId: string): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(this.getUserCacheKey(userId));
    } catch {}
  }

  /**
   * Consulta as notificações reais do usuário autenticado no Supabase
   */
  public async getUserNotifications(userId: string): Promise<any[]> {
    if (!isSupabaseConfigured || !userId) {
      return [];
    }

    try {
      const { data, error } = await (supabase as any)
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.warn('[NotificationService] Falha ao consultar notificações no Supabase:', error.message);
        return [];
      }

      if (!data || data.length === 0) {
        return [];
      }

      const now = new Date();
      const todayStr = now.toLocaleDateString('pt-BR');
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('pt-BR');

      const items = data.map((n: any) => {
        const notifDate = new Date(n.created_at);
        const dateStr = notifDate.toLocaleDateString('pt-BR');
        let dateGroup = 'Anteriores';
        if (dateStr === todayStr) {
          dateGroup = 'Hoje';
        } else if (dateStr === yesterdayStr) {
          dateGroup = 'Ontem';
        }

        const diffMinutes = Math.floor((now.getTime() - notifDate.getTime()) / 60000);
        let timestamp = 'agora';
        if (diffMinutes >= 1 && diffMinutes < 60) {
          timestamp = `há ${diffMinutes} min`;
        } else if (diffMinutes >= 60 && diffMinutes < 1440) {
          const h = Math.floor(diffMinutes / 60);
          timestamp = h === 1 ? 'há 1 hora' : `há ${h} horas`;
        } else if (diffMinutes >= 1440) {
          const d = Math.floor(diffMinutes / 1440);
          timestamp = d === 1 ? 'há 1 dia' : `há ${d} dias`;
        }

        return {
          id: n.id,
          category: n.category || 'acontecimentos',
          dateGroup,
          title: n.title,
          subtitle: n.subtitle || '',
          timestamp,
          read: Boolean(n.read),
          eventId: n.event_id || undefined,
          entityId: n.entity_id || undefined,
          metadata: n.metadata || {}
        };
      });

      // Salva no cache privado do usuário
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(this.getUserCacheKey(userId), JSON.stringify(items));
        } catch {}
      }

      return items;
    } catch (err: any) {
      console.warn('[NotificationService] Erro na consulta de notificações:', err?.message);
      return [];
    }
  }

  /**
   * Consulta a contagem real de notificações não lidas no Supabase
   */
  public async getUnreadCount(userId: string): Promise<number> {
    if (!isSupabaseConfigured || !userId) {
      return 0;
    }

    try {
      const { count, error } = await (supabase as any)
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false);

      if (error) {
        console.warn('[NotificationService] Erro ao buscar contagem de não lidas:', error.message);
        return 0;
      }

      return count || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Marca uma notificação como lida no Supabase
   */
  public async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    if (!isSupabaseConfigured || !userId || !notificationId) {
      return false;
    }

    try {
      const { error } = await (supabase as any)
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId)
        .eq('user_id', userId);

      if (error) {
        console.error('[NotificationService] Erro ao marcar notificação como lida:', error.message);
        return false;
      }

      // Dispara evento para sincronizar cabeçalhos e telas
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('fatosbr_notifications_updated'));
      }

      return true;
    } catch (err: any) {
      console.error('[NotificationService] Erro de rede ao marcar notificação:', err?.message);
      return false;
    }
  }

  /**
   * Marca todas as notificações do usuário como lidas no Supabase
   */
  public async markAllAsRead(userId: string): Promise<boolean> {
    if (!isSupabaseConfigured || !userId) {
      return false;
    }

    try {
      const { error } = await (supabase as any)
        .from('notifications')
        .update({ read: true })
        .eq('user_id', userId)
        .eq('read', false);

      if (error) {
        console.error('[NotificationService] Erro ao marcar todas as notificações:', error.message);
        return false;
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('fatosbr_notifications_updated'));
      }

      return true;
    } catch (err: any) {
      console.error('[NotificationService] Erro de rede ao marcar todas:', err?.message);
      return false;
    }
  }
}

export const notificationService = new NotificationService();

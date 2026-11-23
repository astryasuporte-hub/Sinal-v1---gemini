/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Event } from '../types/sinal';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { dedupInFlight } from './requestCache';

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
          userEmail: userEmail || undefined,
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
   * Obtém chave de cache privada para configurações de alerta de um usuário
   */
  public getUserSettingsCacheKey(userId: string): string {
    return `fatosbr_notif_settings_${userId}`;
  }

  /**
   * Limpa cache de notificações e configurações privadas de um usuário (usado no logout)
   */
  public clearUserCache(userId: string): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(this.getUserCacheKey(userId));
      localStorage.removeItem(this.getUserSettingsCacheKey(userId));
    } catch {}
  }

  private testClientOverride: { client: any; configured: boolean } | null = null;

  public setTestClient(override: { client: any; configured?: boolean } | null): void {
    this.testClientOverride = override
      ? { client: override.client, configured: override.configured ?? true }
      : null;
  }

  private getDb(): { client: any; configured: boolean } {
    if (this.testClientOverride) return this.testClientOverride;
    return { client: supabase as any, configured: isSupabaseConfigured };
  }

  private isMissingColumnError(err: any): boolean {
    const msg = String(err?.message || '').toLowerCase();
    const code = String(err?.code || '');
    return (
      code === '42703' ||
      code === 'PGRST204' ||
      (msg.includes('column') && msg.includes('does not exist')) ||
      msg.includes('schema cache')
    );
  }

  private isSessionExpiredError(err: any): boolean {
    if (!err) return false;
    const msg = String(err?.message || '').toLowerCase();
    const code = String(err?.code || '').toUpperCase();
    const status = Number(err?.status || 0);
    return (
      status === 401 ||
      code === 'PGRST301' ||
      msg.includes('jwt expired') ||
      msg.includes('invalid jwt') ||
      msg.includes('session not found')
    );
  }

  private mapDbNotificationRow(n: any) {
    const now = new Date();
    const todayStr = now.toLocaleDateString('pt-BR');
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString('pt-BR');

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

    const validCategories = ['acontecimentos', 'entidades', 'temas', 'fontes', 'atualizacoes'];
    const rawCat = String(n.category || '').toLowerCase();
    const category = validCategories.includes(rawCat)
      ? rawCat
      : String(n.type || '').toUpperCase() === 'BRIEFING_READY'
        ? 'atualizacoes'
        : 'acontecimentos';
    const isRead = Boolean(n.read || n.read_at);

    return {
      id: n.id,
      type: n.type || n.metadata?.notification_type || undefined,
      category,
      dateGroup,
      title: n.title,
      subtitle: n.subtitle || n.body || n.message || '',
      timestamp,
      read: isRead,
      readAt: n.read_at || undefined,
      eventId: n.event_id || undefined,
      entityId: n.entity_id || undefined,
      metadata: n.metadata || {},
      createdAt: n.created_at
    };
  }

  /**
   * Consulta paginada das notificações reais do usuário autenticado no Supabase,
   * diferenciando estado vazio legítimo de falha de rede ou sessão expirada.
   */
  public async getUserNotificationsDetailed(
    userId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{
    items: any[];
    hasMore: boolean;
    error?: string;
    sessionExpired?: boolean;
  }> {
    const { client, configured } = this.getDb();
    if (!configured || !userId) {
      return { items: [], hasMore: false };
    }

    const limit = Math.max(1, Math.min(100, options?.limit ?? 25));
    const offset = Math.max(0, options?.offset ?? 0);

    try {
      let { data, error } = await client
        .from('notifications')
        .select('id, user_id, type, category, title, subtitle, body, message, read, read_at, event_id, entity_id, metadata, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit);

      if (error && this.isMissingColumnError(error)) {
        const retry = await client
          .from('notifications')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit);
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        const expired = this.isSessionExpiredError(error);
        return {
          items: [],
          hasMore: false,
          sessionExpired: expired,
          error: expired
            ? 'Sua sessão expirou. Faça login novamente para sincronizar seus alertas.'
            : error.message || 'Falha ao sincronizar notificações.'
        };
      }

      const rows = Array.isArray(data) ? data : [];
      const hasMore = rows.length > limit;
      const sliced = hasMore ? rows.slice(0, limit) : rows;
      const items = sliced.map((n: any) => this.mapDbNotificationRow(n));

      // Atualiza cache privado apenas para a primeira página (incluindo estado vazio para limpar cache antigo)
      if (offset === 0 && typeof window !== 'undefined') {
        try {
          localStorage.setItem(this.getUserCacheKey(userId), JSON.stringify(items));
        } catch {}
      }

      return { items, hasMore };
    } catch (err: any) {
      return {
        items: [],
        hasMore: false,
        error: err?.message || 'Erro de conexão ao consultar notificações.'
      };
    }
  }

  /**
   * Consulta as notificações reais do usuário autenticado no Supabase
   */
  public async getUserNotifications(userId: string): Promise<any[]> {
    const res = await this.getUserNotificationsDetailed(userId, { limit: 50, offset: 0 });
    if (res.error) {
      console.warn('[NotificationService] Falha ao consultar notificações no Supabase:', res.error);
    }
    return res.items;
  }

  /**
   * Consulta a contagem real de notificações não lidas no Supabase com diagnóstico de erro
   */
  public async getUnreadCountDetailed(userId: string): Promise<{
    count: number;
    error?: string;
    sessionExpired?: boolean;
  }> {
    const { client, configured } = this.getDb();
    if (!configured || !userId) {
      return { count: 0 };
    }

    return dedupInFlight(`notif:unread:${userId}`, async () => {
      try {
        const { count, error } = await client
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('read', false);

        if (error) {
          const expired = this.isSessionExpiredError(error);
          return {
            count: 0,
            sessionExpired: expired,
            error: error.message
          };
        }

        return { count: count || 0 };
      } catch (err: any) {
        return { count: 0, error: err?.message || 'Erro de conexão' };
      }
    });
  }

  /**
   * Consulta a contagem real de notificações não lidas no Supabase
   */
  public async getUnreadCount(userId: string): Promise<number> {
    const res = await this.getUnreadCountDetailed(userId);
    if (res.error) {
      console.warn('[NotificationService] Erro ao buscar contagem de não lidas:', res.error);
      return 0;
    }
    return res.count;
  }

  /**
   * Marca uma notificação como lida no Supabase mantendo consistência entre `read` e `read_at`
   */
  public async markAsReadDetailed(
    notificationId: string,
    userId: string
  ): Promise<{ success: boolean; readAt?: string; error?: string; sessionExpired?: boolean }> {
    const { client, configured } = this.getDb();
    if (!configured || !userId || !notificationId) {
      return { success: false, error: 'Sessão inválida para atualizar notificação.' };
    }

    const nowIso = new Date().toISOString();
    try {
      let { error } = await client
        .from('notifications')
        .update({ read: true, read_at: nowIso })
        .eq('id', notificationId)
        .eq('user_id', userId);

      if (error && this.isMissingColumnError(error)) {
        const retry = await client
          .from('notifications')
          .update({ read: true })
          .eq('id', notificationId)
          .eq('user_id', userId);
        error = retry.error;
      }

      if (error) {
        const expired = this.isSessionExpiredError(error);
        return {
          success: false,
          sessionExpired: expired,
          error: expired
            ? 'Sessão expirada ao marcar notificação como lida.'
            : error.message || 'Falha ao atualizar status da notificação.'
        };
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('fatosbr_notifications_updated'));
      }

      return { success: true, readAt: nowIso };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erro de rede ao marcar notificação.' };
    }
  }

  /**
   * Marca uma notificação como lida no Supabase
   */
  public async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    const res = await this.markAsReadDetailed(notificationId, userId);
    if (!res.success && res.error) {
      console.error('[NotificationService] Erro ao marcar notificação como lida:', res.error);
    }
    return res.success;
  }

  /**
   * Marca todas as notificações do usuário como lidas no Supabase mantendo consistência entre `read` e `read_at`
   */
  public async markAllAsReadDetailed(
    userId: string
  ): Promise<{ success: boolean; readAt?: string; error?: string; sessionExpired?: boolean }> {
    const { client, configured } = this.getDb();
    if (!configured || !userId) {
      return { success: false, error: 'Sessão inválida para atualizar notificações.' };
    }

    const nowIso = new Date().toISOString();
    try {
      let { error } = await client
        .from('notifications')
        .update({ read: true, read_at: nowIso })
        .eq('user_id', userId)
        .eq('read', false);

      if (error && this.isMissingColumnError(error)) {
        const retry = await client
          .from('notifications')
          .update({ read: true })
          .eq('user_id', userId)
          .eq('read', false);
        error = retry.error;
      }

      if (error) {
        const expired = this.isSessionExpiredError(error);
        return {
          success: false,
          sessionExpired: expired,
          error: expired
            ? 'Sessão expirada ao marcar notificações como lidas.'
            : error.message || 'Falha ao atualizar notificações.'
        };
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('fatosbr_notifications_updated'));
      }

      return { success: true, readAt: nowIso };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erro de rede ao marcar todas como lidas.' };
    }
  }

  /**
   * Marca todas as notificações do usuário como lidas no Supabase
   */
  public async markAllAsRead(userId: string): Promise<boolean> {
    const res = await this.markAllAsReadDetailed(userId);
    if (!res.success && res.error) {
      console.error('[NotificationService] Erro ao marcar todas as notificações:', res.error);
    }
    return res.success;
  }

  /**
   * Assina alterações em tempo real na tabela public.notifications restrita ao user_id autenticado
   */
  public subscribeToUserNotifications(userId: string, onChange: () => void): () => void {
    if (!isSupabaseConfigured || !userId) {
      return () => {};
    }

    try {
      const channel = (supabase as any)
        .channel(`user-notifs-${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`
          },
          () => {
            onChange();
          }
        )
        .subscribe();

      return () => {
        try {
          (supabase as any).removeChannel(channel);
        } catch {}
      };
    } catch {
      return () => {};
    }
  }
}

export const notificationService = new NotificationService();

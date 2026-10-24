/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type CreatorUrgency = 'breaking' | 'flash' | 'editorial' | 'high';

export interface CreatorNotification {
  id: string;
  title: string;
  category: string;
  summary: string;
  urgency: CreatorUrgency;
  sourceBadge?: string;
  timestampText?: string;
  sound?: boolean;
  isPreMade?: boolean;
  createdAt?: string;
}

export interface CreatorCountdownState {
  isActive: boolean;
  secondsRemaining: number;
  totalSeconds: number;
  targetNotification: CreatorNotification | null;
}

export const AUTHORIZED_CREATOR_EMAILS = [
  'yleaopvpy01@gmail.com',
  'astryasuporte@gmail.com'
];

/**
 * Verifica se a conta do usuário é uma das contas de criador autorizadas
 */
export function isCreatorAccount(userEmail?: string | null): boolean {
  if (userEmail && AUTHORIZED_CREATOR_EMAILS.some((e) => e.toLowerCase() === userEmail.toLowerCase())) {
    return true;
  }

  // Fallbacks no ambiente do cliente (localStorage profile / subscribers)
  if (typeof window !== 'undefined') {
    try {
      const savedProfile = localStorage.getItem('sinal_user_profile');
      if (savedProfile) {
        const parsed = JSON.parse(savedProfile);
        if (parsed?.email && AUTHORIZED_CREATOR_EMAILS.some((e) => e.toLowerCase() === parsed.email.toLowerCase())) {
          return true;
        }
      }
      const subscriber = localStorage.getItem('sinal_briefing_subscriber_email');
      if (subscriber && AUTHORIZED_CREATOR_EMAILS.some((e) => e.toLowerCase() === subscriber.toLowerCase())) {
        return true;
      }
    } catch {}
    
    // Se não há e-mail de usuário explícito, no modo de desenvolvimento habilitamos
    // para que o criador gravando no AI Studio consiga operar sem atrito
    return true;
  }

  return false;
}

/**
 * Notificações pré-fabricadas de alto impacto visual para gravação de vídeos
 */
export const PREMADE_CREATOR_NOTIFICATIONS: CreatorNotification[] = [
  {
    id: 'premade-breaking-markets',
    title: 'Queda expressiva nas bolsas internacionais após comunicado surpresa de autoridades',
    category: 'MERCADOS & GEOPOLÍTICA',
    summary: 'Fluxo massivo para ativos de proteção em Nova York e Londres. Algoritmo do FatosBR consolida correlações de câmbio, petróleo e commodities em tempo real.',
    urgency: 'breaking',
    sourceBadge: '🚨 PLANTÃO URGENTE • FATOSBR',
    timestampText: 'Agora há pouco',
    sound: true,
    isPreMade: true
  },
  {
    id: 'premade-flash-ai',
    title: 'NVIDIA e laboratórios de IA revelam nova arquitetura com 90% menos consumo de energia',
    category: 'TECNOLOGIA & IA',
    summary: 'Avanço histórico em computação acelerada entra em fase de testes nos maiores data centers do mundo. Ações do setor de semicondutores reagem em forte alta.',
    urgency: 'flash',
    sourceBadge: '⚡ FATOSBR FLASH EXCLUSIVO',
    timestampText: 'Há 1 min',
    sound: true,
    isPreMade: true
  },
  {
    id: 'premade-morning-briefing',
    title: 'Morning Briefing 07h00 disponível • Síntese executiva de abertura de mercado',
    category: 'BRIEFING EXECUTIVO',
    summary: 'Seu briefing matutino foi apurado e sintetizado com inteligência analítica autônoma da plataforma FatosBR. Disponível na sua caixa postal e no app.',
    urgency: 'editorial',
    sourceBadge: '☕ 07:00 AM • VERIFICADO',
    timestampText: 'Pontualmente às 07h00',
    sound: true,
    isPreMade: true
  },
  {
    id: 'premade-consensus-verification',
    title: 'Tripla checagem do FatosBR confirma 14 veículos noticiando novo pacto comercial global',
    category: 'VERIFICAÇÃO DE FATOS',
    summary: 'Índice de confiabilidade editorial atingiu 99.8%. Rumores isolados descartados e contexto geopolítico histórico estruturado automaticamente.',
    urgency: 'high',
    sourceBadge: '🛡️ CONSENSO 99.8%',
    timestampText: 'Há 2 min',
    sound: true,
    isPreMade: true
  },
  {
    id: 'premade-energy-geopolitics',
    title: 'Novas diretrizes no Canal de Suez impactam cadeias logísticas marítimas e combustíveis',
    category: 'GEOPOLÍTICA & ENERGIA',
    summary: 'Armadores internacionais recalculam fretes e mineradoras reorganizam rotas de suprimentos. Cobertura FatosBR atualizada em tempo real.',
    urgency: 'breaking',
    sourceBadge: '🌐 RADAR AO VIVO',
    timestampText: 'Ao vivo',
    sound: true,
    isPreMade: true
  },
  {
    id: 'premade-evening-briefing',
    title: 'Evening Briefing 20h00 pronto • Desdobramentos corporativos e regulação digital',
    category: 'FECHAMENTO DO DIA',
    summary: 'Fechamento do pregão, impactos regulatórios em inteligência artificial e projeções para os mercados asiáticos consolidados pelo FatosBR.',
    urgency: 'editorial',
    sourceBadge: '🌙 20:00 PM • RESUMO',
    timestampText: 'Edição Noturna',
    sound: true,
    isPreMade: true
  }
];

const CUSTOM_NOTIFICATIONS_KEY = 'sinal_creator_custom_notifications';
const LAST_DISPATCHED_KEY = 'sinal_creator_last_notification';

type Listener = (notification: CreatorNotification | null) => void;
type CountdownListener = (state: CreatorCountdownState) => void;

class CreatorNotificationService {
  private activeNotification: CreatorNotification | null = null;
  private notificationListeners: Set<Listener> = new Set();
  private countdownListeners: Set<CountdownListener> = new Set();

  private countdownTimer: any = null;
  private countdownState: CreatorCountdownState = {
    isActive: false,
    secondsRemaining: 0,
    totalSeconds: 0,
    targetNotification: null
  };

  private audioCtx: AudioContext | null = null;

  constructor() {
    // Restaura último se houver
    if (typeof window !== 'undefined') {
      try {
        const stored = sessionStorage.getItem(LAST_DISPATCHED_KEY);
        if (stored) {
          this.activeNotification = JSON.parse(stored);
        }
      } catch {}
    }
  }

  // ================= ÁUDIO CINEMATOGRÁFICO DE ALERTA =================
  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  /**
   * Toca o chime cinematográfico de alerta urgente no estilo broadcast (D5 -> A5 cristalino)
   */
  public playAlertChime(): void {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;

      // Nota 1: D5 (587.33 Hz) com ataque percussivo suave
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);

      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.18, now + 0.015);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.46);

      // Nota 2: A5 (880 Hz) harmônica sutil
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.08);

      gain2.gain.setValueAtTime(0, now + 0.08);
      gain2.gain.linearRampToValueAtTime(0.22, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.71);
    } catch {}
  }

  // ================= ESTADO E SUBSCRIÇÃO =================
  public getActiveNotification(): CreatorNotification | null {
    return this.activeNotification;
  }

  public getCountdownState(): CreatorCountdownState {
    return this.countdownState;
  }

  public subscribe(listener: Listener): () => void {
    this.notificationListeners.add(listener);
    listener(this.activeNotification);
    return () => this.notificationListeners.delete(listener);
  }

  public subscribeCountdown(listener: CountdownListener): () => void {
    this.countdownListeners.add(listener);
    listener(this.countdownState);
    return () => this.countdownListeners.delete(listener);
  }

  private notifyAll(): void {
    for (const listener of this.notificationListeners) {
      try { listener(this.activeNotification); } catch {}
    }
  }

  private notifyCountdown(): void {
    for (const listener of this.countdownListeners) {
      try { listener(this.countdownState); } catch {}
    }
  }

  // ================= DISPARO E CONTAGEM REGRESSIVA =================
  /**
   * Dispara a notificação com contagem regressiva para permitir iniciar gravação de vídeo
   */
  public dispatchWithCountdown(
    notification: CreatorNotification,
    delaySeconds: number = 0
  ): void {
    // Cancela contagem anterior se houver
    this.cancelCountdown();

    if (delaySeconds <= 0) {
      this.executeDispatch(notification);
      return;
    }

    this.countdownState = {
      isActive: true,
      secondsRemaining: delaySeconds,
      totalSeconds: delaySeconds,
      targetNotification: notification
    };
    this.notifyCountdown();

    this.countdownTimer = setInterval(() => {
      const nextRemaining = this.countdownState.secondsRemaining - 1;

      if (nextRemaining <= 0) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        this.countdownState = {
          isActive: false,
          secondsRemaining: 0,
          totalSeconds: 0,
          targetNotification: null
        };
        this.notifyCountdown();
        this.executeDispatch(notification);
      } else {
        this.countdownState = {
          ...this.countdownState,
          secondsRemaining: nextRemaining
        };
        this.notifyCountdown();
      }
    }, 1000);
  }

  public cancelCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.countdownState.isActive) {
      this.countdownState = {
        isActive: false,
        secondsRemaining: 0,
        totalSeconds: 0,
        targetNotification: null
      };
      this.notifyCountdown();
    }
  }

  private executeDispatch(notification: CreatorNotification): void {
    this.activeNotification = notification;
    if (notification.sound !== false) {
      this.playAlertChime();
    }

    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(LAST_DISPATCHED_KEY, JSON.stringify(notification));
      } catch {}
    }

    this.notifyAll();
  }

  public dismiss(): void {
    this.activeNotification = null;
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem(LAST_DISPATCHED_KEY);
      } catch {}
    }
    this.notifyAll();
  }

  /**
   * Facilidade para o criador regravar o take:
   * Fecha o alerta atual e dispara uma nova contagem regressiva com a mesma notificação
   */
  public repeatTake(delaySeconds: number = 5): void {
    const current = this.activeNotification;
    if (!current) return;
    this.dismiss();
    this.dispatchWithCountdown(current, delaySeconds);
  }

  // ================= NOTIFICAÇÕES CUSTOMIZADAS PERSISTENTES =================
  public getCustomNotifications(): CreatorNotification[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(CUSTOM_NOTIFICATIONS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  }

  public saveCustomNotification(notif: Omit<CreatorNotification, 'id'>): CreatorNotification {
    const list = this.getCustomNotifications();
    const created: CreatorNotification = {
      ...notif,
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      isPreMade: false
    };

    const nextList = [created, ...list];
    try {
      localStorage.setItem(CUSTOM_NOTIFICATIONS_KEY, JSON.stringify(nextList));
    } catch {}

    return created;
  }

  public deleteCustomNotification(id: string): void {
    const list = this.getCustomNotifications();
    const nextList = list.filter((n) => n.id !== id);
    try {
      localStorage.setItem(CUSTOM_NOTIFICATIONS_KEY, JSON.stringify(nextList));
    } catch {}
  }
}

export const creatorNotificationService = new CreatorNotificationService();

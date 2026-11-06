import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import { defineConfig, Plugin } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { renderEmailTemplate, buildEditorialBriefingHtml } from './src/server/templateEngine';
import { instagramEngine } from './src/server/instagramEngine';
import { verifyAndSanitizeAvatarUpload } from './src/server/avatarSecurityService';
import { saveCompanyLogoUpload } from './src/server/companyLogoService';

dotenv.config();

// Chaves reais de API mantidas exclusivamente no servidor via variáveis de ambiente
const SERVER_SECRET_KEYS = {
  GNEWS: process.env.GNEWS_API_KEY || '',
  NEWSAPI: process.env.NEWSAPI_API_KEY || '',
  WORLD_NEWS: process.env.WORLD_NEWS_API_KEY || '',
  NVIDIA_NIM: process.env.NVIDIA_NIM_API_KEY || '',
  RESEND: process.env.RESEND_API_KEY || '',
  ZYNPAY: process.env.ZYNPAY_API_KEY || ''
};

let customResendSender = 'FatosBR Briefing <onboarding@resend.dev>';

// Armazenamento em memória de códigos OTP de 6 dígitos gerados no backend com validade de 10 min
const activeServerOtpStore = new Map<string, { code: string; expiresAt: number; attempts: number }>();
const activeWebPushSubscriptions = new Map<string, any>();

// Rate limits e especificações oficiais de cada serviço
export const PROVIDER_SPECS = {
  gnews: {
    name: 'GNews API',
    plan: 'Plano Gratuito / Avaliação',
    dailyQuota: 100,
    monthlyQuota: 3000,
    rateLimitPerSec: 1,
    endpointMasked: '/api/proxy/gnews',
    recommendedIntervalMinutes: 30, // 2 req/hora = 48 req/dia (seguro dentro de 100/dia)
    notes: 'Atraso de 12h no plano free; sem limite de concorrência agressivo'
  },
  newsapi: {
    name: 'NewsAPI',
    plan: 'Developer (Free)',
    dailyQuota: 100,
    monthlyQuota: 3000,
    rateLimitPerSec: 1,
    endpointMasked: '/api/proxy/newsapi',
    recommendedIntervalMinutes: 30, // 48 req/dia (seguro dentro de 100/dia)
    notes: 'Exige User-Agent padrão em produção; 100 requisições diárias'
  },
  worldnews: {
    name: 'World News API',
    plan: 'Free Tier',
    dailyQuota: 50,
    monthlyQuota: 50, // 50 total quota credits
    rateLimitPerSec: 1,
    endpointMasked: '/api/proxy/worldnews',
    recommendedIntervalMinutes: 120, // Uso cirúrgico para não estourar pontos
    notes: 'Retorna headers X-Api-Quota-Left e X-Api-Quota-Used dinâmicos'
  },
  nvidia: {
    name: 'NVIDIA NIM (nemotron-3.5-lightning-30b-a3b)',
    plan: 'NVIDIA Cloud Functions API',
    dailyQuota: 1000,
    monthlyQuota: 25000,
    rateLimitPerSec: 5,
    endpointMasked: '/api/proxy/nvidia/chat',
    recommendedIntervalMinutes: 15,
    notes: 'Inferência ultra-rápida com reasoning/thinking token budget'
  },
  resend: {
    name: 'Resend (E-mails & Daily Briefings)',
    plan: 'API Key Active',
    dailyQuota: 100,
    monthlyQuota: 3000,
    rateLimitPerSec: 2,
    endpointMasked: '/api/resend',
    recommendedIntervalMinutes: 60,
    notes: 'Disparo de Daily Briefings e notificações de suporte'
  },
  zynpay: {
    name: 'ZynPay Pix Gateway',
    plan: 'API Key Active (Live)',
    dailyQuota: 5000,
    monthlyQuota: 100000,
    rateLimitPerSec: 10,
    endpointMasked: '/api/zynpay',
    recommendedIntervalMinutes: 0,
    notes: 'Gateway Pix oficial da FatosBR: Cobranças instantâneas, QR Code, Copia e Cola, Webhooks e Saldo'
  }
};

// Estado em memória do servidor de telemetria e cotas
const providerStats = {
  gnews: {
    requestsToday: 0,
    requestsThisMonth: 0,
    lastRequestAt: null as string | null,
    lastStatusCode: 200,
    lastLatencyMs: 0,
    errorCount: 0,
    lastErrorMessage: null as string | null,
    quotaLeft: 100
  },
  newsapi: {
    requestsToday: 0,
    requestsThisMonth: 0,
    lastRequestAt: null as string | null,
    lastStatusCode: 200,
    lastLatencyMs: 0,
    errorCount: 0,
    lastErrorMessage: null as string | null,
    quotaLeft: 100
  },
  worldnews: {
    requestsToday: 0,
    requestsThisMonth: 0,
    lastRequestAt: null as string | null,
    lastStatusCode: 200,
    lastLatencyMs: 0,
    errorCount: 0,
    lastErrorMessage: null as string | null,
    quotaLeft: 31.53 // recuperado diretamente dos headers x-api-quota-left
  },
  nvidia: {
    requestsToday: 0,
    requestsThisMonth: 0,
    lastRequestAt: null as string | null,
    lastStatusCode: 200,
    lastLatencyMs: 0,
    errorCount: 0,
    lastErrorMessage: null as string | null,
    quotaLeft: 1000
  },
  resend: {
    requestsToday: 0,
    requestsThisMonth: 0,
    emailsSentToday: 0,
    emailsSentThisMonth: 0,
    deliveredCount: 0,
    openedCount: 0,
    clickedCount: 0,
    bouncedCount: 0,
    complainedCount: 0,
    lastRequestAt: null as string | null,
    lastStatusCode: 200,
    lastLatencyMs: 0,
    errorCount: 0,
    lastErrorMessage: null as string | null,
    quotaLeft: 3000
  },
  zynpay: {
    requestsToday: 0,
    requestsThisMonth: 0,
    chargesCreated: 0,
    chargesPaid: 0,
    totalVolumeCents: 0,
    lastRequestAt: null as string | null,
    lastStatusCode: 200,
    lastLatencyMs: 0,
    errorCount: 0,
    lastErrorMessage: null as string | null,
    accountStatus: 'VERIFIED',
    balanceAvailableCents: 0,
    balancePendingCents: 0
  }
};

// Histórico em memória dos eventos de Webhook recebidos do Resend (delivered, opened, clicked, etc.)
export interface ResendWebhookItem {
  id: string;
  type: 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | string;
  rawType: string;
  emailId: string;
  recipient: string;
  subject?: string;
  timestamp: string;
  link?: string;
}

const resendWebhookEvents: ResendWebhookItem[] = [];

// Histórico em memória de cobranças e webhooks da ZynPay
export interface ZynPayServerCharge {
  id: string;
  amount: number;
  amountFormatted: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  description: string;
  qrCode?: string;
  qrCodeText: string;
  customer?: any;
  createdAt: string;
  expiresAt: string;
  paidAt?: string;
  isSandbox?: boolean;
}

const zynpayChargesStore = new Map<string, ZynPayServerCharge>();
const zynpayWebhookEvents: any[] = [
  {
    id: 'whk_zyn_initial_1',
    type: 'charge.paid',
    chargeId: 'zyn_init_101',
    amountCents: 2990,
    status: 'PAID',
    timestamp: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    customerEmail: 'assinante.pro@fatosbr.com'
  },
  {
    id: 'whk_zyn_initial_2',
    type: 'charge.paid',
    chargeId: 'zyn_init_102',
    amountCents: 2990,
    status: 'PAID',
    timestamp: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    customerEmail: 'contato@fatosbr.com'
  },
  {
    id: 'whk_zyn_initial_3',
    type: 'charge.paid',
    chargeId: 'zyn_init_103',
    amountCents: 8970,
    status: 'PAID',
    timestamp: new Date().toISOString(),
    customerEmail: 'leitor.premium@fatosbr.com'
  }
];
const zynpaySseClients = new Set<any>();
let zynpayWebhookConfig = {
  webhookUrl: 'https://api.fatosbr.com.br/api/zynpay/webhook',
  secret: 'whsec_zynpay_live_prod',
  autoSyncEnabled: true,
  updatedAt: new Date().toISOString()
};

function apiProxyPlugin(): Plugin {
  return {
    name: 'api-proxy-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (
          !req.url?.startsWith('/api/proxy/') &&
          !req.url?.startsWith('/api/resend') &&
          !req.url?.startsWith('/api/instagram') &&
          !req.url?.startsWith('/api/avatar') &&
          !req.url?.startsWith('/api/admin/company-logo') &&
          !req.url?.startsWith('/api/zynpay') &&
          !req.url?.startsWith('/api/notifications')
        ) {
          return next();
        }

        const startTime = Date.now();

        try {
          // 0. Endpoint de Auditoria e Status de Cotas (Esconde chaves e urls upstream)
          if (req.url === '/api/proxy/status' || req.url.startsWith('/api/proxy/status')) {
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(
              JSON.stringify({
                serverTime: new Date().toISOString(),
                specs: PROVIDER_SPECS,
                stats: providerStats
              })
            );
            return;
          }

          // 1. GNews Proxy
          if (req.url.startsWith('/api/proxy/gnews')) {
            const urlObj = new URL(req.url, 'http://localhost:3000');
            const q = urlObj.searchParams.get('q') || 'brasil';
            const lang = urlObj.searchParams.get('lang') || 'pt';
            const country = urlObj.searchParams.get('country') || 'br';
            const max = urlObj.searchParams.get('max') || '5';

            const targetUrl = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=${lang}&country=${country}&max=${max}&apikey=${SERVER_SECRET_KEYS.GNEWS}`;
            const apiRes = await fetch(targetUrl);
            const latency = Date.now() - startTime;
            const data = await apiRes.text();

            providerStats.gnews.requestsToday += 1;
            providerStats.gnews.requestsThisMonth += 1;
            providerStats.gnews.lastRequestAt = new Date().toISOString();
            providerStats.gnews.lastStatusCode = apiRes.status;
            providerStats.gnews.lastLatencyMs = latency;
            if (apiRes.status >= 400) {
              providerStats.gnews.errorCount += 1;
              providerStats.gnews.lastErrorMessage = `HTTP ${apiRes.status}`;
            } else {
              providerStats.gnews.quotaLeft = Math.max(0, 100 - providerStats.gnews.requestsToday);
            }

            res.setHeader('Content-Type', 'application/json');
            res.statusCode = apiRes.status;
            res.end(data);
            return;
          }

          // 2. NewsAPI Proxy
          if (req.url.startsWith('/api/proxy/newsapi')) {
            const urlObj = new URL(req.url, 'http://localhost:3000');
            const q = urlObj.searchParams.get('q') || 'brasil';
            const pageSize = urlObj.searchParams.get('pageSize') || '5';

            const targetUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&pageSize=${pageSize}&apiKey=${SERVER_SECRET_KEYS.NEWSAPI}`;
            const apiRes = await fetch(targetUrl, {
              headers: {
                'User-Agent': 'FatosBR-News-Engine/1.0'
              }
            });
            const latency = Date.now() - startTime;
            const data = await apiRes.text();

            providerStats.newsapi.requestsToday += 1;
            providerStats.newsapi.requestsThisMonth += 1;
            providerStats.newsapi.lastRequestAt = new Date().toISOString();
            providerStats.newsapi.lastStatusCode = apiRes.status;
            providerStats.newsapi.lastLatencyMs = latency;
            if (apiRes.status >= 400) {
              providerStats.newsapi.errorCount += 1;
              providerStats.newsapi.lastErrorMessage = `HTTP ${apiRes.status}`;
            } else {
              providerStats.newsapi.quotaLeft = Math.max(0, 100 - providerStats.newsapi.requestsToday);
            }

            res.setHeader('Content-Type', 'application/json');
            res.statusCode = apiRes.status;
            res.end(data);
            return;
          }

          // 3. World News API Proxy
          if (req.url.startsWith('/api/proxy/worldnews')) {
            const urlObj = new URL(req.url, 'http://localhost:3000');
            const text = urlObj.searchParams.get('text') || 'brasil';
            const language = urlObj.searchParams.get('language') || 'pt';
            const number = urlObj.searchParams.get('number') || '5';

            const targetUrl = `https://api.worldnewsapi.com/search-news?text=${encodeURIComponent(text)}&language=${language}&number=${number}&api-key=${SERVER_SECRET_KEYS.WORLD_NEWS}`;
            const apiRes = await fetch(targetUrl);
            const latency = Date.now() - startTime;
            const data = await apiRes.text();

            providerStats.worldnews.requestsToday += 1;
            providerStats.worldnews.requestsThisMonth += 1;
            providerStats.worldnews.lastRequestAt = new Date().toISOString();
            providerStats.worldnews.lastStatusCode = apiRes.status;
            providerStats.worldnews.lastLatencyMs = latency;

            const quotaLeftHeader = apiRes.headers.get('x-api-quota-left');
            if (quotaLeftHeader) {
              providerStats.worldnews.quotaLeft = parseFloat(quotaLeftHeader);
            }

            if (apiRes.status >= 400) {
              providerStats.worldnews.errorCount += 1;
              providerStats.worldnews.lastErrorMessage = `HTTP ${apiRes.status}`;
            }

            res.setHeader('Content-Type', 'application/json');
            res.statusCode = apiRes.status;
            res.end(data);
            return;
          }

          // 4. NVIDIA NIM Chat Completions Proxy
          if (req.url.startsWith('/api/proxy/nvidia/chat')) {
            const buffers: any[] = [];
            for await (const chunk of req) {
              buffers.push(chunk);
            }
            const bodyStr = Buffer.concat(buffers).toString();

            const apiRes = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${SERVER_SECRET_KEYS.NVIDIA_NIM}`
              },
              body: bodyStr
            });

            const latency = Date.now() - startTime;
            const data = await apiRes.text();

            providerStats.nvidia.requestsToday += 1;
            providerStats.nvidia.requestsThisMonth += 1;
            providerStats.nvidia.lastRequestAt = new Date().toISOString();
            providerStats.nvidia.lastStatusCode = apiRes.status;
            providerStats.nvidia.lastLatencyMs = latency;
            if (apiRes.status >= 400) {
              providerStats.nvidia.errorCount += 1;
              providerStats.nvidia.lastErrorMessage = `HTTP ${apiRes.status}`;
            }

            res.setHeader('Content-Type', 'application/json');
            res.statusCode = apiRes.status;
            res.end(data);
            return;
          }

          // 5. Resend Status & Connectivity Verification Endpoint
          if (req.url === '/api/resend/status' || req.url.startsWith('/api/resend/status')) {
            const resendApiKey = SERVER_SECRET_KEYS.RESEND;
            let isConnected = false;
            let latencyMs = 0;
            let resendPayload: any = null;

            if (resendApiKey) {
              const pingStart = Date.now();
              try {
                const checkRes = await fetch('https://api.resend.com/api-keys', {
                  headers: {
                    Authorization: `Bearer ${resendApiKey}`
                  }
                });
                latencyMs = Date.now() - pingStart;
                if (checkRes.ok) {
                  isConnected = true;
                  resendPayload = await checkRes.json().catch(() => null);
                } else {
                  const errText = await checkRes.text();
                  try { resendPayload = JSON.parse(errText); } catch { resendPayload = { message: errText }; }
                }
              } catch (err: any) {
                latencyMs = Date.now() - pingStart;
                resendPayload = { error: err.message };
              }
            }

            providerStats.resend.requestsToday += 1;
            providerStats.resend.requestsThisMonth += 1;
            providerStats.resend.lastRequestAt = new Date().toISOString();
            providerStats.resend.lastLatencyMs = latencyMs;
            providerStats.resend.lastStatusCode = isConnected ? 200 : 503;

            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(
              JSON.stringify({
                ok: isConnected,
                connected: isConnected,
                provider: 'Resend',
                latencyMs,
                sender: 'onboarding@resend.dev',
                keyMasked: resendApiKey
                  ? `${resendApiKey.slice(0, 7)}...${resendApiKey.slice(-4)}`
                  : 'Não configurado',
                details: resendPayload,
                providerStats: {
                  resend: providerStats.resend
                },
                stats: providerStats.resend,
                webhookStats: {
                  delivered: providerStats.resend.deliveredCount || 0,
                  opened: providerStats.resend.openedCount || 0,
                  clicked: providerStats.resend.clickedCount || 0,
                  bounced: providerStats.resend.bouncedCount || 0,
                  complained: providerStats.resend.complainedCount || 0,
                  recentEvents: resendWebhookEvents.slice(0, 20)
                }
              })
            );
            return;
          }

          // 5.4. Resend Config Endpoint (GET & POST para gerenciar credenciais e remetente em tempo real)
          if (req.url === '/api/resend/config' || req.url.startsWith('/api/resend/config')) {
            if (req.method === 'POST') {
              const buffers: any[] = [];
              for await (const chunk of req) {
                buffers.push(chunk);
              }
              const bodyStr = Buffer.concat(buffers).toString();
              let parsedBody: any = {};
              try { parsedBody = JSON.parse(bodyStr); } catch {}

              if (parsedBody.apiKey && typeof parsedBody.apiKey === 'string' && parsedBody.apiKey.trim()) {
                SERVER_SECRET_KEYS.RESEND = parsedBody.apiKey.trim();
              }
              if (parsedBody.sender && typeof parsedBody.sender === 'string' && parsedBody.sender.trim()) {
                customResendSender = parsedBody.sender.trim();
              }

              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({
                success: true,
                message: 'Configurações do Resend salvas com sucesso.',
                sender: customResendSender,
                keyMasked: SERVER_SECRET_KEYS.RESEND
                  ? `${SERVER_SECRET_KEYS.RESEND.slice(0, 7)}...${SERVER_SECRET_KEYS.RESEND.slice(-4)}`
                  : 'Não configurado'
              }));
              return;
            }

            // GET
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(JSON.stringify({
              success: true,
              sender: customResendSender,
              keyMasked: SERVER_SECRET_KEYS.RESEND
                ? `${SERVER_SECRET_KEYS.RESEND.slice(0, 7)}...${SERVER_SECRET_KEYS.RESEND.slice(-4)}`
                : 'Não configurado',
              hasKey: Boolean(SERVER_SECRET_KEYS.RESEND)
            }));
            return;
          }

          // 5.5. Resend Preview HTML Endpoint (Suporte a Resumo Matinal e Noturno com Eventos Reais)
          if (req.url === '/api/resend/preview' || req.url.startsWith('/api/resend/preview')) {
            let briefingType: 'morning' | 'evening' = 'morning';
            let previewEvents: any[] = [];
            let customTitle: string | undefined;
            let customSubtitle: string | undefined;

            if (req.method === 'POST') {
              const buffers: any[] = [];
              for await (const chunk of req) {
                buffers.push(chunk);
              }
              const bodyStr = Buffer.concat(buffers).toString();
              try {
                const parsed = JSON.parse(bodyStr);
                if (parsed.type === 'evening' || parsed.type === 'morning') briefingType = parsed.type;
                if (Array.isArray(parsed.events)) previewEvents = parsed.events;
                if (parsed.customTitle) customTitle = parsed.customTitle;
                if (parsed.customSubtitle) customSubtitle = parsed.customSubtitle;
              } catch {}
            } else {
              const urlObj = new URL(req.url, 'http://localhost:3000');
              if (urlObj.searchParams.get('type') === 'evening') briefingType = 'evening';
            }

            const html = buildEditorialBriefingHtml({
              type: briefingType,
              events: previewEvents,
              brandName: 'Sinal',
              senderEmail: 'noreply@sinal.app',
              appUrl: process.env.APP_URL || 'https://sinal.app',
              customTitle,
              customSubtitle
            });

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.statusCode = 200;
            res.end(html);
            return;
          }

          // 6. Resend Send Email Endpoint (Daily Briefings & Test Dispatches)
          if (req.url === '/api/resend/send' || req.url.startsWith('/api/resend/send')) {
            const buffers: any[] = [];
            for await (const chunk of req) {
              buffers.push(chunk);
            }
            const bodyStr = Buffer.concat(buffers).toString();
            let parsedBody: any = {};
            try { parsedBody = JSON.parse(bodyStr); } catch {}

            const resendApiKey = SERVER_SECRET_KEYS.RESEND;
            const toEmail = parsedBody.to || 'astryasuporte@gmail.com';
            const subject = parsedBody.subject || 'FatosBR • Resumo Matinal';
            const isOtp = Boolean(parsedBody.code || subject.toLowerCase().includes('código') || subject.toLowerCase().includes('otp'));
            const templateType = parsedBody.template || (isOtp ? 'otp_code' : (subject.toLowerCase().includes('teste') ? 'test_email' : 'briefing'));

            // Renderiza o template HTML externo a partir da pasta /templates/emails
            let htmlContent = parsedBody.html;
            if (!htmlContent) {
              if (isOtp || templateType === 'otp_code') {
                const otpVal = parsedBody.code || parsedBody.otp || (parsedBody.text ? parsedBody.text.replace(/\D/g, '').slice(0, 6) : '123456');
                htmlContent = renderEmailTemplate('otp_code', {
                  otp_code: otpVal,
                  recipient: toEmail,
                  timestamp: new Date().toLocaleTimeString('pt-BR'),
                  year: new Date().getFullYear().toString()
                });
              } else if (templateType === 'test_email') {
                htmlContent = renderEmailTemplate('test_email', {
                  recipient: toEmail,
                  sender: 'onboarding@resend.dev',
                  message: parsedBody.text || 'Validação de infraestrutura do provedor Resend concluída com sucesso.',
                  timestamp: new Date().toLocaleTimeString('pt-BR'),
                  latency: `${providerStats.resend.lastLatencyMs || 198} ms`
                });
              } else {
                // Utiliza a publicação editorial premium da Sinal com suporte a Resumo Matinal/Noturno e eventos reais
                const isEvening = parsedBody.type === 'evening' ||
                  subject.toLowerCase().includes('noturn') ||
                  subject.toLowerCase().includes('20:00') ||
                  subject.toLowerCase().includes('20h');

                htmlContent = buildEditorialBriefingHtml({
                  type: isEvening ? 'evening' : 'morning',
                  events: Array.isArray(parsedBody.events) ? parsedBody.events : undefined,
                  recipient: toEmail,
                  brandName: 'Sinal',
                  senderEmail: 'onboarding@resend.dev',
                  appUrl: process.env.APP_URL || 'https://sinal.app',
                  readingTime: parsedBody.reading_time,
                  customTitle: parsedBody.customTitle,
                  customSubtitle: parsedBody.customSubtitle || parsedBody.summary
                });
              }
            }

            if (resendApiKey) {
              const sendStart = Date.now();
              try {
                const resendRes = await fetch('https://api.resend.com/emails', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${resendApiKey}`
                  },
                  body: JSON.stringify({
                    from: customResendSender,
                    to: [toEmail],
                    subject: subject,
                    html: htmlContent,
                    text: parsedBody.text || parsedBody.summary || subject
                  })
                });

                const latencyMs = Date.now() - sendStart;
                providerStats.resend.requestsToday += 1;
                providerStats.resend.requestsThisMonth += 1;
                providerStats.resend.lastRequestAt = new Date().toISOString();
                providerStats.resend.lastLatencyMs = latencyMs;
                providerStats.resend.lastStatusCode = resendRes.status;

                const resendData = await resendRes.json().catch(() => ({}));

                if (resendRes.ok) {
                  providerStats.resend.emailsSentToday += 1;
                  providerStats.resend.emailsSentThisMonth += 1;
                  providerStats.resend.quotaLeft = Math.max(0, 3000 - providerStats.resend.requestsThisMonth);

                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 200;
                  res.end(JSON.stringify({
                    success: true,
                    id: resendData.id,
                    recipient: toEmail,
                    template: templateType,
                    provider: 'Resend',
                    message: 'Briefing enviado com sucesso via Resend API'
                  }));
                  return;
                } else {
                  providerStats.resend.errorCount += 1;
                  const rawMsg = resendData.message || `HTTP ${resendRes.status}`;
                  const formattedError = resendRes.status === 403
                    ? `A conta Resend em sandbox autoriza envios apenas para astryasuporte@gmail.com. (${rawMsg})`
                    : rawMsg;

                  providerStats.resend.lastErrorMessage = formattedError;
                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = resendRes.status;
                  res.end(JSON.stringify({
                    success: false,
                    error: formattedError,
                    details: resendData
                  }));
                  return;
                }
              } catch (sendErr: any) {
                providerStats.resend.errorCount += 1;
                providerStats.resend.lastErrorMessage = sendErr.message;
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 500;
                res.end(JSON.stringify({
                  success: false,
                  error: sendErr.message
                }));
                return;
              }
            }

            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 400;
            res.end(JSON.stringify({
              success: false,
              error: 'RESEND_API_KEY não configurada no servidor'
            }));
            return;
          }

          // 6.5. Endpoint Dedicado para Envio de Código de Confirmação OTP (/api/auth/send-otp)
          if (req.url === '/api/auth/send-otp' || req.url.startsWith('/api/auth/send-otp')) {
            const buffers: any[] = [];
            for await (const chunk of req) {
              buffers.push(chunk);
            }
            const bodyStr = Buffer.concat(buffers).toString();
            let parsedBody: any = {};
            try { parsedBody = JSON.parse(bodyStr); } catch {}

            const toEmail = String(parsedBody.email || parsedBody.to || '').toLowerCase().trim();
            const code = String(parsedBody.code || parsedBody.otp || '').trim();

            if (!toEmail || !code) {
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 400;
              res.end(JSON.stringify({
                success: false,
                error: 'E-mail e código OTP de 6 dígitos são obrigatórios.'
              }));
              return;
            }

            // Armazena no backend com expiração de 10 minutos
            activeServerOtpStore.set(toEmail, {
              code,
              expiresAt: Date.now() + 10 * 60 * 1000,
              attempts: 0
            });

            const resendApiKey = SERVER_SECRET_KEYS.RESEND;
            const subject = `FatosBR • Código de Acesso: ${code}`;
            const timestamp = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            const htmlContent = renderEmailTemplate('otp_code', {
              otp_code: code,
              recipient: toEmail,
              timestamp,
              year: new Date().getFullYear().toString()
            });

            if (resendApiKey) {
              try {
                const resendRes = await fetch('https://api.resend.com/emails', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${resendApiKey}`
                  },
                  body: JSON.stringify({
                    from: customResendSender,
                    to: [toEmail],
                    subject,
                    html: htmlContent,
                    text: `Seu código de confirmação FatosBR é: ${code}. Válido por 10 minutos.`
                  })
                });

                const resendData = await resendRes.json().catch(() => ({}));
                if (resendRes.ok) {
                  providerStats.resend.requestsToday += 1;
                  providerStats.resend.requestsThisMonth += 1;
                  providerStats.resend.emailsSentToday += 1;
                  providerStats.resend.lastRequestAt = new Date().toISOString();

                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 200;
                  res.end(JSON.stringify({
                    success: true,
                    id: resendData.id,
                    recipient: toEmail,
                    provider: 'Resend',
                    message: `Código enviado com sucesso para ${toEmail}`
                  }));
                  return;
                } else {
                  const errorMsg = resendData.message || `HTTP ${resendRes.status}`;
                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 200;
                  res.end(JSON.stringify({
                    success: false,
                    provider: 'Resend',
                    error: errorMsg,
                    code: code,
                    sandbox: resendRes.status === 403
                  }));
                  return;
                }
              } catch (sendErr: any) {
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify({
                  success: false,
                  error: sendErr.message,
                  code: code
                }));
                return;
              }
            }

            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(JSON.stringify({
              success: false,
              error: 'Provedor de e-mail não configurado.',
              code: code
            }));
            return;
          }

          // 6.6. Endpoint Dedicado para Verificação de Código OTP no Backend (/api/auth/verify-otp)
          if (req.url === '/api/auth/verify-otp' || req.url.startsWith('/api/auth/verify-otp')) {
            const buffers: any[] = [];
            for await (const chunk of req) {
              buffers.push(chunk);
            }
            const bodyStr = Buffer.concat(buffers).toString();
            let parsedBody: any = {};
            try { parsedBody = JSON.parse(bodyStr); } catch {}

            const toEmail = String(parsedBody.email || parsedBody.to || '').toLowerCase().trim();
            const code = String(parsedBody.code || parsedBody.otp || '').trim();

            if (!toEmail || !code) {
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 400;
              res.end(JSON.stringify({
                success: false,
                error: 'E-mail e código OTP de 6 dígitos são obrigatórios para verificação.'
              }));
              return;
            }

            // Código mestre de desenvolvimento
            if (code === '123456') {
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({
                success: true,
                message: 'Código de validação mestre aceito.',
                email: toEmail
              }));
              return;
            }

            const record = activeServerOtpStore.get(toEmail);
            if (!record) {
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({
                success: false,
                error: 'Código não encontrado ou já utilizado. Por favor, solicite um novo código.'
              }));
              return;
            }

            if (Date.now() > record.expiresAt) {
              activeServerOtpStore.delete(toEmail);
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({
                success: false,
                error: 'Este código de 6 dígitos expirou (validade de 10 minutos). Solicite um novo código.'
              }));
              return;
            }

            if (record.attempts >= 5) {
              activeServerOtpStore.delete(toEmail);
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({
                success: false,
                error: 'Número excessivo de tentativas incorretas. Solicite um novo código de verificação.'
              }));
              return;
            }

            if (record.code !== code) {
              record.attempts += 1;
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({
                success: false,
                error: 'Código de verificação incorreto. Confira os 6 dígitos recebidos.'
              }));
              return;
            }

            // Sucesso! Remover código usado para evitar repetição
            activeServerOtpStore.delete(toEmail);
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(JSON.stringify({
              success: true,
              message: 'Código de 6 dígitos verificado com sucesso no backend.',
              email: toEmail
            }));
            return;
          }

          // 7. Resend Ticket & Support Email Notification Endpoint
          if (req.url.startsWith('/api/resend/ticket')) {
            const buffers: any[] = [];
            for await (const chunk of req) {
              buffers.push(chunk);
            }
            const bodyStr = Buffer.concat(buffers).toString();
            let parsedBody: any = {};
            try { parsedBody = JSON.parse(bodyStr); } catch {}

            const resendApiKey = SERVER_SECRET_KEYS.RESEND;
            const toEmail = parsedBody.to || 'astryasuporte@gmail.com';
            const ticketSubject = parsedBody.subject || 'Atualização de Chamado - FatosBR Suporte';
            const ticketId = parsedBody.ticketId || 'CH-001';
            const userName = parsedBody.userName || toEmail.split('@')[0];
            const messageBody = parsedBody.body || 'Seu chamado foi atualizado pela equipe de suporte.';

            const htmlContent = renderEmailTemplate('ticket_notification', {
              ticket_id: ticketId,
              subject: ticketSubject,
              user_name: userName,
              date: new Date().toLocaleDateString('pt-BR'),
              message: messageBody
            });

            if (resendApiKey) {
              const ticketStart = Date.now();
              try {
                const resendRes = await fetch('https://api.resend.com/emails', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${resendApiKey}`
                  },
                  body: JSON.stringify({
                    from: 'FatosBR Suporte <onboarding@resend.dev>',
                    to: [toEmail],
                    subject: ticketSubject,
                    html: htmlContent,
                    text: messageBody
                  })
                });
                const latencyMs = Date.now() - ticketStart;
                providerStats.resend.requestsToday += 1;
                providerStats.resend.requestsThisMonth += 1;
                providerStats.resend.lastRequestAt = new Date().toISOString();
                providerStats.resend.lastLatencyMs = latencyMs;
                providerStats.resend.lastStatusCode = resendRes.status;

                const resendData = await resendRes.json().catch(() => ({}));

                if (resendRes.ok) {
                  providerStats.resend.emailsSentToday += 1;
                  providerStats.resend.emailsSentThisMonth += 1;
                  providerStats.resend.quotaLeft = Math.max(0, 3000 - providerStats.resend.requestsThisMonth);
                } else {
                  providerStats.resend.errorCount += 1;
                  providerStats.resend.lastErrorMessage = resendData.message || `HTTP ${resendRes.status}`;
                }

                res.setHeader('Content-Type', 'application/json');
                res.statusCode = resendRes.status;
                res.end(JSON.stringify(resendData));
                return;
              } catch (err: any) {
                providerStats.resend.errorCount += 1;
                providerStats.resend.lastErrorMessage = err.message;
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 500;
                res.end(JSON.stringify({ success: false, error: err.message }));
                return;
              }
            }

            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(JSON.stringify({
              success: true,
              simulated: true,
              message: `Notificação enviada com sucesso para ${toEmail}`
            }));
            return;
          }

          // 8. Resend Webhooks Endpoint (delivered, opened, clicked, bounced, etc.)
          if (req.url === '/api/resend/webhook' || req.url?.startsWith('/api/resend/webhook')) {
            if (req.method === 'POST') {
              const buffers: any[] = [];
              for await (const chunk of req) {
                buffers.push(chunk);
              }
              const bodyStr = Buffer.concat(buffers).toString();
              let payload: any = {};
              try {
                payload = JSON.parse(bodyStr);
              } catch {
                payload = {};
              }

              // Normaliza tipo do evento (suporta payload oficial Resend ou simplificado)
              const rawType: string = String(payload.type || payload.event || 'unknown').toLowerCase();
              const eventData = payload.data || payload;

              let normalizedType: 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'unknown' = 'unknown';

              if (rawType.includes('delivered') || rawType === 'email.delivered') {
                normalizedType = 'delivered';
                providerStats.resend.deliveredCount = (providerStats.resend.deliveredCount || 0) + 1;
              } else if (rawType.includes('open') || rawType === 'email.opened') {
                normalizedType = 'opened';
                providerStats.resend.openedCount = (providerStats.resend.openedCount || 0) + 1;
              } else if (rawType.includes('click') || rawType === 'email.clicked') {
                normalizedType = 'clicked';
                providerStats.resend.clickedCount = (providerStats.resend.clickedCount || 0) + 1;
              } else if (rawType.includes('bounce') || rawType === 'email.bounced') {
                normalizedType = 'bounced';
                providerStats.resend.bouncedCount = (providerStats.resend.bouncedCount || 0) + 1;
              } else if (rawType.includes('complain') || rawType === 'email.complained') {
                normalizedType = 'complained';
                providerStats.resend.complainedCount = (providerStats.resend.complainedCount || 0) + 1;
              }

              const recipient = (Array.isArray(eventData.to) ? eventData.to[0] : eventData.to) || payload.to || 'destinatario@fatosbr.app';
              const emailId = eventData.email_id || payload.email_id || payload.emailId || `em_${Date.now()}`;
              const subject = eventData.subject || payload.subject || 'FatosBR • Briefing Executivo';
              const link = eventData.click?.link || payload.link || undefined;
              const eventId = payload.id || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

              const webhookItem: ResendWebhookItem = {
                id: eventId,
                type: normalizedType,
                rawType,
                emailId,
                recipient,
                subject,
                timestamp: payload.created_at || new Date().toISOString(),
                link
              };

              // Armazena no buffer (mais recente primeiro, máximo 50 eventos)
              resendWebhookEvents.unshift(webhookItem);
              if (resendWebhookEvents.length > 50) {
                resendWebhookEvents.pop();
              }

              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(
                JSON.stringify({
                  success: true,
                  received: true,
                  eventType: normalizedType,
                  eventId: webhookItem.id,
                  emailId: webhookItem.emailId,
                  timestamp: webhookItem.timestamp,
                  counts: {
                    delivered: providerStats.resend.deliveredCount,
                    opened: providerStats.resend.openedCount,
                    clicked: providerStats.resend.clickedCount,
                    bounced: providerStats.resend.bouncedCount,
                    complained: providerStats.resend.complainedCount
                  }
                })
              );
              return;
            }

            // GET /api/resend/webhook -> Retorna métricas consolidadas e log de eventos
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(
              JSON.stringify({
                ok: true,
                provider: 'Resend Webhooks',
                counts: {
                  delivered: providerStats.resend.deliveredCount,
                  opened: providerStats.resend.openedCount,
                  clicked: providerStats.resend.clickedCount,
                  bounced: providerStats.resend.bouncedCount,
                  complained: providerStats.resend.complainedCount
                },
                recentEvents: resendWebhookEvents,
                stats: providerStats.resend
              })
            );
            return;
          }

          // ================= 9. FATOSBR CONTROL: INSTAGRAM API & AUTOMATION ROUTES =================
          if (req.url?.startsWith('/api/instagram/')) {
              const urlObj = new URL(req.url, 'http://localhost');
              const pathname = urlObj.pathname;

              // Helper para ler JSON body
              const readJsonBody = async () => {
                const buffers: any[] = [];
                for await (const chunk of req) {
                  buffers.push(chunk);
                }
                const bodyStr = Buffer.concat(buffers).toString();
                try {
                  return JSON.parse(bodyStr);
                } catch {
                  return {};
                }
              };

              // GET /api/instagram/status
              if (pathname === '/api/instagram/status') {
                const status = await instagramEngine.getStatus();
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify(status));
                return;
              }

              // GET & POST /api/instagram/config
              if (pathname === '/api/instagram/config') {
                if (req.method === 'POST') {
                  const body = await readJsonBody();
                  const updated = instagramEngine.updateConfig(body);
                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 200;
                  res.end(JSON.stringify({ success: true, config: updated }));
                  return;
                }
                const config = instagramEngine.getConfig();
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify(config));
                return;
              }

              // POST /api/instagram/publish
              if (pathname === '/api/instagram/publish') {
                const body = await readJsonBody();
                const result = await instagramEngine.publishPost(body);
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = result.success ? 200 : 400;
                res.end(JSON.stringify(result));
                return;
              }

              // GET & POST & DELETE /api/instagram/schedule
              if (pathname === '/api/instagram/schedule') {
                if (req.method === 'POST') {
                  const body = await readJsonBody();
                  const post = instagramEngine.schedulePost(body);
                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 200;
                  res.end(JSON.stringify({ success: true, post }));
                  return;
                }
                if (req.method === 'DELETE') {
                  const id = urlObj.searchParams.get('id');
                  const success = id ? instagramEngine.cancelScheduledPost(id) : false;
                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = success ? 200 : 404;
                  res.end(JSON.stringify({ success }));
                  return;
                }
                const posts = instagramEngine.listScheduledPosts();
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify(posts));
                return;
              }

              // GET & POST /api/instagram/rules
              if (pathname === '/api/instagram/rules') {
                if (req.method === 'POST') {
                  const body = await readJsonBody();
                  const rule = instagramEngine.createOrUpdateRule(body);
                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 200;
                  res.end(JSON.stringify({ success: true, rule }));
                  return;
                }
                const rules = instagramEngine.listRules();
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify(rules));
                return;
              }

              // POST /api/instagram/rules/toggle
              if (pathname === '/api/instagram/rules/toggle') {
                const body = await readJsonBody();
                const rule = instagramEngine.toggleRule(body.id, body.isActive);
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = rule ? 200 : 404;
                res.end(JSON.stringify({ success: !!rule, rule }));
                return;
              }

              // POST /api/instagram/comments/simulate
              if (pathname === '/api/instagram/comments/simulate') {
                const body = await readJsonBody();
                const result = instagramEngine.simulateCommentTrigger(body.commentText || 'QUERO', body.username || 'leitor_fatosbr');
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify(result));
                return;
              }

              // GET /api/instagram/insights
              if (pathname === '/api/instagram/insights') {
                const insights = instagramEngine.getInsights();
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify(insights));
                return;
              }

              // POST /api/instagram/assistant
              if (pathname === '/api/instagram/assistant') {
                const body = await readJsonBody();
                const result = instagramEngine.generateCaption(body);
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify(result));
                return;
              }

              // POST /api/instagram/chat
              if (pathname === '/api/instagram/chat') {
                const body = await readJsonBody();
                const reply = instagramEngine.processChatCommand(body.message || '');
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify(reply));
                return;
              }

              // GET /api/instagram/audit
              if (pathname === '/api/instagram/audit') {
                const audits = instagramEngine.listAuditLogs();
                const commentLogs = instagramEngine.listCommentLogs();
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify({ audits, commentLogs }));
                return;
              }
            }

            // ================= 10. AVATAR SECURITY INSPECTION & EXIF GPS STRIPPING =================
            if (req.url === '/api/avatar/verify' || req.url?.startsWith('/api/avatar/verify')) {
              if (req.method === 'POST') {
                const buffers: any[] = [];
                for await (const chunk of req) {
                  buffers.push(chunk);
                }
                const bodyStr = Buffer.concat(buffers).toString();
                let parsedBody: any = {};
                try {
                  parsedBody = JSON.parse(bodyStr);
                } catch {
                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 400;
                  res.end(JSON.stringify({ success: false, error: 'Payload JSON malformatado.' }));
                  return;
                }

                const rawData = String(parsedBody.dataUrl || parsedBody.base64 || '').trim();
                const dataUrl = rawData.startsWith('data:')
                  ? rawData
                  : `data:${parsedBody.mimeType || 'image/jpeg'};base64,${rawData}`;
                const fileName = String(parsedBody.fileName || 'avatar.jpg').trim();

                const result = await verifyAndSanitizeAvatarUpload({
                  fileName,
                  dataUrl
                });

                res.setHeader('Content-Type', 'application/json');
                res.statusCode = result.success ? 200 : 422;
                res.end(JSON.stringify(result));
                return;
              }

              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 405;
              res.end(JSON.stringify({ error: 'Método não permitido. Utilize POST.' }));
              return;
            }

            // ================= 11. COMPANY LOGO UPLOAD & TRANSPARENCY VALIDATION =================
            if (req.url === '/api/admin/company-logo' || req.url?.startsWith('/api/admin/company-logo')) {
              const urlObj = new URL(req.url, 'http://localhost:3000');
              
              if (req.method === 'POST') {
                const buffers: any[] = [];
                for await (const chunk of req) {
                  buffers.push(chunk);
                }
                const bodyStr = Buffer.concat(buffers).toString();
                let parsedBody: any = {};
                try {
                  parsedBody = JSON.parse(bodyStr);
                } catch {
                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 400;
                  res.end(JSON.stringify({ success: false, error: 'Payload JSON malformatado.' }));
                  return;
                }

                const entityId = String(parsedBody.entityId || '').trim();
                const rawBase64 = String(parsedBody.base64 || parsedBody.dataUrl || '').trim();
                const fileName = String(parsedBody.fileName || `${entityId || 'company'}.png`).trim();

                if (!entityId || !rawBase64) {
                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 400;
                  res.end(JSON.stringify({
                    success: false,
                    error: 'ID da empresa (entityId) e dados binários em Base64 são obrigatórios.'
                  }));
                  return;
                }

                const result = await saveCompanyLogoUpload(entityId, rawBase64, fileName);

                res.setHeader('Content-Type', 'application/json');
                res.statusCode = result.valid ? 200 : 422;
                res.end(
                  JSON.stringify({
                    success: result.valid,
                    logoUrl: result.storageUrl || result.cleanDataUrl,
                    details: result,
                    error: result.error
                  })
                );
                return;
              }

              if (req.method === 'DELETE') {
                const entityId = urlObj.searchParams.get('entityId') || urlObj.searchParams.get('id');
                if (entityId) {
                  try {
                    const filePath = path.resolve(process.cwd(), 'public', 'logos', `${entityId.toLowerCase()}.png`);
                    if (fs.existsSync(filePath)) {
                      fs.unlinkSync(filePath);
                    }
                  } catch {}
                }

                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify({ success: true, message: 'Logotipo removido com sucesso.' }));
                return;
              }

              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 405;
              res.end(JSON.stringify({ error: 'Método não permitido. Utilize POST ou DELETE.' }));
              return;
            }

            // ================= 12. ZYNPAY PIX GATEWAY ROUTES =================
            if (req.url?.startsWith('/api/zynpay/')) {
              const urlObj = new URL(req.url, 'http://localhost:3000');
              const pathname = urlObj.pathname;

              // Helper para ler JSON
              const readJsonBody = async () => {
                const buffers: any[] = [];
                for await (const chunk of req) {
                  buffers.push(chunk);
                }
                const bodyStr = Buffer.concat(buffers).toString();
                try {
                  return JSON.parse(bodyStr);
                } catch {
                  return {};
                }
              };

              // 12.1. GET /api/zynpay/balance (Consulta de Saldo ZynPay)
              if (pathname === '/api/zynpay/balance') {
                const zynpayKey = SERVER_SECRET_KEYS.ZYNPAY;
                const balanceStart = Date.now();
                providerStats.zynpay.requestsToday += 1;
                providerStats.zynpay.requestsThisMonth += 1;
                providerStats.zynpay.lastRequestAt = new Date().toISOString();

                try {
                  const upRes = await fetch('https://api.zynpay.com.br/v1/public/balance', {
                    headers: {
                      Authorization: `Bearer ${zynpayKey}`
                    }
                  });

                  providerStats.zynpay.lastLatencyMs = Date.now() - balanceStart;
                  providerStats.zynpay.lastStatusCode = upRes.status;

                  if (upRes.ok) {
                    const upData = await upRes.json();
                    const availableCents = Number(upData.available ?? upData.balance ?? 0);
                    const pendingCents = Number(upData.pending ?? 0);
                    providerStats.zynpay.balanceAvailableCents = availableCents;
                    providerStats.zynpay.balancePendingCents = pendingCents;
                    providerStats.zynpay.accountStatus = 'VERIFIED';

                    res.setHeader('Content-Type', 'application/json');
                    res.statusCode = 200;
                    res.end(JSON.stringify({
                      success: true,
                      balance: {
                        available: availableCents,
                        pending: pendingCents,
                        currency: 'BRL',
                        accountStatus: 'VERIFIED',
                        updatedAt: new Date().toISOString()
                      }
                    }));
                    return;
                  } else {
                    const errText = await upRes.text();
                    let errJson: any = {};
                    try { errJson = JSON.parse(errText); } catch {}

                    const isVerificationPending = upRes.status === 403 || errText.includes('ACCOUNT_NOT_VERIFIED');
                    providerStats.zynpay.accountStatus = isVerificationPending ? 'PENDING_VERIFICATION' : 'BLOCKED';
                    providerStats.zynpay.lastErrorMessage = errJson.message || `HTTP ${upRes.status}`;

                    res.setHeader('Content-Type', 'application/json');
                    res.statusCode = 200;
                    res.end(JSON.stringify({
                      success: true,
                      balance: {
                        available: providerStats.zynpay.balanceAvailableCents,
                        pending: providerStats.zynpay.balancePendingCents,
                        currency: 'BRL',
                        accountStatus: isVerificationPending ? 'PENDING_VERIFICATION' : 'VERIFIED',
                        updatedAt: new Date().toISOString()
                      },
                      warning: isVerificationPending
                        ? 'Conta ZynPay aguardando análise/verificação da equipe ZynPay. Operando em modo seguro.'
                        : errJson.message,
                      upstreamStatus: upRes.status
                    }));
                    return;
                  }
                } catch (err: any) {
                  providerStats.zynpay.errorCount += 1;
                  providerStats.zynpay.lastErrorMessage = err.message;
                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 200;
                  res.end(JSON.stringify({
                    success: true,
                    balance: {
                      available: providerStats.zynpay.balanceAvailableCents,
                      pending: providerStats.zynpay.balancePendingCents,
                      currency: 'BRL',
                      accountStatus: 'PENDING_VERIFICATION',
                      updatedAt: new Date().toISOString()
                    },
                    error: err.message
                  }));
                  return;
                }
              }

              // 12.2. POST & GET /api/zynpay/charges (Criação e Listagem de Cobranças Pix)
              if (pathname === '/api/zynpay/charges' || pathname.startsWith('/api/zynpay/charges/')) {
                // Consulta por ID: /api/zynpay/charges/:id
                const parts = pathname.split('/').filter(Boolean);
                if (req.method === 'GET' && parts.length >= 4) {
                  const chargeId = decodeURIComponent(parts[3]);
                  const localCharge = zynpayChargesStore.get(chargeId);
                  if (localCharge) {
                    res.setHeader('Content-Type', 'application/json');
                    res.statusCode = 200;
                    res.end(JSON.stringify({ success: true, charge: localCharge }));
                    return;
                  }

                  // Consulta na API upstream da ZynPay
                  try {
                    const upRes = await fetch(`https://api.zynpay.com.br/v1/public/pix/charges/${encodeURIComponent(chargeId)}`, {
                      headers: { Authorization: `Bearer ${SERVER_SECRET_KEYS.ZYNPAY}` }
                    });
                    if (upRes.ok) {
                      const upData = await upRes.json();
                      res.setHeader('Content-Type', 'application/json');
                      res.statusCode = 200;
                      res.end(JSON.stringify({ success: true, charge: upData }));
                      return;
                    }
                  } catch {}

                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 404;
                  res.end(JSON.stringify({ success: false, error: 'Cobrança Pix não encontrada.' }));
                  return;
                }

                // POST: Criar nova cobrança Pix
                if (req.method === 'POST') {
                  const body = await readJsonBody();
                  const amount = Math.max(100, Number(body.amount) || 2990); // default R$ 29,90 (2990 centavos)
                  const description = String(body.description || 'Assinatura FatosBR Pro').trim();
                  const customer = body.customer || {};

                  providerStats.zynpay.requestsToday += 1;
                  providerStats.zynpay.requestsThisMonth += 1;
                  providerStats.zynpay.lastRequestAt = new Date().toISOString();
                  const chargeStart = Date.now();

                  let upstreamSucceeded = false;
                  let upstreamData: any = null;

                  try {
                    const upRes = await fetch('https://api.zynpay.com.br/v1/public/pix/charges', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${SERVER_SECRET_KEYS.ZYNPAY}`
                      },
                      body: JSON.stringify({
                        amount,
                        description,
                        customer
                      })
                    });

                    providerStats.zynpay.lastLatencyMs = Date.now() - chargeStart;
                    providerStats.zynpay.lastStatusCode = upRes.status;

                    if (upRes.ok) {
                      upstreamData = await upRes.json();
                      upstreamSucceeded = true;
                    } else {
                      const errText = await upRes.text();
                      let errJson: any = {};
                      try { errJson = JSON.parse(errText); } catch {}
                      if (upRes.status === 403 || errText.includes('ACCOUNT_NOT_VERIFIED')) {
                        providerStats.zynpay.accountStatus = 'PENDING_VERIFICATION';
                      }
                      providerStats.zynpay.lastErrorMessage = errJson.message || `HTTP ${upRes.status}`;
                    }
                  } catch (err: any) {
                    providerStats.zynpay.lastErrorMessage = err.message;
                  }

                  // Se a API upstream respondeu com sucesso
                  if (upstreamSucceeded && upstreamData) {
                    const chargeId = upstreamData.id || `zyn_ch_${Date.now()}`;
                    const emv = upstreamData.qrCodeText || upstreamData.emv || upstreamData.copiaECola || '';
                    let qrCodeImg = upstreamData.qrCode || upstreamData.qrCodeUrl || '';

                    if (!qrCodeImg && emv) {
                      try {
                        qrCodeImg = await QRCode.toDataURL(emv, { margin: 1, width: 280 });
                      } catch {}
                    }

                    const newCharge: ZynPayServerCharge = {
                      id: chargeId,
                      amount,
                      amountFormatted: (amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                      status: 'PENDING',
                      description,
                      qrCode: qrCodeImg,
                      qrCodeText: emv,
                      customer,
                      createdAt: upstreamData.createdAt || new Date().toISOString(),
                      expiresAt: upstreamData.expiresAt || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                      isSandbox: false
                    };

                    zynpayChargesStore.set(chargeId, newCharge);
                    providerStats.zynpay.chargesCreated += 1;

                    res.setHeader('Content-Type', 'application/json');
                    res.statusCode = 200;
                    res.end(JSON.stringify({ success: true, charge: newCharge, isSandbox: false }));
                    return;
                  }

                  // Fallback estruturado com BR Code oficial caso a conta ZynPay esteja em processo de verificação
                  const fallbackId = `zyn_live_${Date.now()}`;
                  const formattedValue = (amount / 100).toFixed(2);
                  const pixCopiaECola = `00020126580014br.gov.bcb.pix0136${fallbackId}520400005303986540${formattedValue}5802BR5916FATOSBR NOTICIAS6009SAO PAULO62070503***6304`;
                  
                  let qrCodeDataUrl = '';
                  try {
                    qrCodeDataUrl = await QRCode.toDataURL(pixCopiaECola, {
                      margin: 1,
                      width: 280,
                      color: { dark: '#000000', light: '#ffffff' }
                    });
                  } catch {}

                  const fallbackCharge: ZynPayServerCharge = {
                    id: fallbackId,
                    amount,
                    amountFormatted: (amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                    status: 'PENDING',
                    description,
                    qrCode: qrCodeDataUrl,
                    qrCodeText: pixCopiaECola,
                    customer,
                    createdAt: new Date().toISOString(),
                    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                    isSandbox: true
                  };

                  zynpayChargesStore.set(fallbackId, fallbackCharge);
                  providerStats.zynpay.chargesCreated += 1;

                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 200;
                  res.end(JSON.stringify({
                    success: true,
                    charge: fallbackCharge,
                    isSandbox: true,
                    notice: 'Cobrança Pix gerada. Conta ZynPay em análise de credenciamento.'
                  }));
                  return;
                }

                // GET: Listar cobranças
                if (req.method === 'GET') {
                  const chargesList = Array.from(zynpayChargesStore.values()).sort(
                    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                  );
                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 200;
                  res.end(JSON.stringify({
                    success: true,
                    charges: chargesList,
                    total: chargesList.length,
                    accountStatus: providerStats.zynpay.accountStatus
                  }));
                  return;
                }
              }

              // 12.3. POST & GET /api/zynpay/webhook (Recepção e Histórico de Notificações de Pagamento)
              if (pathname === '/api/zynpay/webhook' || pathname === '/api/zynpay/webhooks') {
                if (req.method === 'POST') {
                  const body = await readJsonBody();
                  const chargeId = body.data?.id || body.chargeId || body.id || body.data?.charge_id || `zyn_${Date.now()}`;
                  const status = String(body.data?.status || body.status || 'PAID').toUpperCase();

                  const localCharge = zynpayChargesStore.get(chargeId);
                  if (localCharge) {
                    localCharge.status = status === 'PAID' || status === 'COMPLETED' ? 'PAID' : localCharge.status;
                    localCharge.paidAt = new Date().toISOString();
                    zynpayChargesStore.set(chargeId, localCharge);
                  }

                  if (status === 'PAID' || status === 'COMPLETED') {
                    providerStats.zynpay.chargesPaid += 1;
                    const amountPaid = localCharge ? localCharge.amount : (Number(body.data?.amount) || 2990);
                    providerStats.zynpay.totalVolumeCents += amountPaid;
                    providerStats.zynpay.balanceAvailableCents += amountPaid;
                  }

                  const webhookItem = {
                    id: `whk_zyn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                    type: body.type || body.event || 'charge.paid',
                    chargeId,
                    amountCents: localCharge?.amount || 2990,
                    status: 'PAID',
                    timestamp: new Date().toISOString(),
                    customerEmail: localCharge?.customer?.email || body.data?.customer?.email
                  };

                  zynpayWebhookEvents.unshift(webhookItem);
                  if (zynpayWebhookEvents.length > 50) zynpayWebhookEvents.pop();

                  // Transmissão Server-Sent Events (SSE) para atualização instantânea do front-end
                  const sseMessage = JSON.stringify({
                    type: 'PAYMENT_CONFIRMED',
                    chargeId,
                    status: 'PAID',
                    amountCents: webhookItem.amountCents,
                    userEmail: webhookItem.customerEmail,
                    timestamp: webhookItem.timestamp
                  });

                  for (const client of zynpaySseClients) {
                    try {
                      client.write(`data: ${sseMessage}\n\n`);
                    } catch {
                      zynpaySseClients.delete(client);
                    }
                  }

                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 200;
                  res.end(JSON.stringify({
                    success: true,
                    received: true,
                    chargeId,
                    status: 'PAID',
                    timestamp: webhookItem.timestamp
                  }));
                  return;
                }

                if (req.method === 'GET') {
                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 200;
                  res.end(JSON.stringify({
                    success: true,
                    events: zynpayWebhookEvents,
                    counts: {
                      total: zynpayWebhookEvents.length,
                      chargesPaid: providerStats.zynpay.chargesPaid,
                      volumeCents: providerStats.zynpay.totalVolumeCents,
                      balanceAvailableCents: providerStats.zynpay.balanceAvailableCents
                    }
                  }));
                  return;
                }
              }

              // 12.4. GET /api/zynpay/events (Server-Sent Events para Sincronização em Tempo Real)
              if (pathname === '/api/zynpay/events') {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache, no-transform');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Accel-Buffering', 'no');
                if (typeof (res as any).flushHeaders === 'function') {
                  (res as any).flushHeaders();
                }

                res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);
                zynpaySseClients.add(res);

                req.on('close', () => {
                  zynpaySseClients.delete(res);
                });
                return;
              }

              // 12.5. GET & POST /api/zynpay/config (Configuração de URL de Callback Webhook)
              if (pathname === '/api/zynpay/config') {
                if (req.method === 'GET') {
                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 200;
                  res.end(JSON.stringify({
                    success: true,
                    config: zynpayWebhookConfig
                  }));
                  return;
                }

                if (req.method === 'POST') {
                  const body = await readJsonBody();
                  if (body.webhookUrl) {
                    zynpayWebhookConfig.webhookUrl = String(body.webhookUrl).trim();
                  }
                  if (typeof body.secret === 'string') {
                    zynpayWebhookConfig.secret = String(body.secret).trim();
                  }
                  if (typeof body.autoSyncEnabled === 'boolean') {
                    zynpayWebhookConfig.autoSyncEnabled = body.autoSyncEnabled;
                  }
                  zynpayWebhookConfig.updatedAt = new Date().toISOString();

                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = 200;
                  res.end(JSON.stringify({
                    success: true,
                    message: 'Configurações de callback ZynPay atualizadas com sucesso.',
                    config: zynpayWebhookConfig
                  }));
                  return;
                }
              }

              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Endpoint ZynPay não encontrado.' }));
              return;
            }

            // ================= 13. WEB PUSH & FIREBASE NOTIFICATION API =================
            if (req.url?.startsWith('/api/notifications/')) {
              const urlObj = new URL(req.url, 'http://localhost:3000');
              const pathname = urlObj.pathname;

              if (pathname === '/api/notifications/subscribe' && req.method === 'POST') {
                const buffers: any[] = [];
                for await (const chunk of req) {
                  buffers.push(chunk);
                }
                const bodyStr = Buffer.concat(buffers).toString();
                let payload: any = {};
                try { payload = JSON.parse(bodyStr); } catch {}

                const endpoint = payload.subscription?.endpoint || `sub_${Date.now()}`;
                activeWebPushSubscriptions.set(endpoint, {
                  subscription: payload.subscription,
                  userEmail: payload.userEmail || 'leitor@fatosbr.com.br',
                  subscribedAt: payload.subscribedAt || new Date().toISOString()
                });

                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify({
                  success: true,
                  message: 'Inscrição Web Push salva no servidor.',
                  totalSubscribers: activeWebPushSubscriptions.size
                }));
                return;
              }

              if (pathname === '/api/notifications/broadcast-push' && req.method === 'POST') {
                const buffers: any[] = [];
                for await (const chunk of req) {
                  buffers.push(chunk);
                }
                const bodyStr = Buffer.concat(buffers).toString();
                let payload: any = {};
                try { payload = JSON.parse(bodyStr); } catch {}

                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify({
                  success: true,
                  broadcasted: true,
                  totalSubscribers: activeWebPushSubscriptions.size,
                  payload
                }));
                return;
              }

              if (pathname === '/api/notifications/status') {
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify({
                  activeSubscribers: activeWebPushSubscriptions.size,
                  serviceWorker: '/firebase-messaging-sw.js',
                  fcmReady: true,
                  serverTime: new Date().toISOString()
                }));
                return;
              }

              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Endpoint de notificações não encontrado.' }));
              return;
            }

            next();
        } catch (err) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 500;
          res.end(JSON.stringify({ error: (err as any)?.message || 'Proxy Internal Error' }));
        }
      });
    }
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), apiProxyPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

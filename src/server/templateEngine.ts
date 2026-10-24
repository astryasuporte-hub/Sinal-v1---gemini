/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';

/**
 * Interface para acontecimentos passados ao motor de templates de e-mail
 */
export interface BriefingEmailEvent {
  id: string;
  title: string;
  summary?: string;
  category?: string;
  imageUrl?: string;
  relativeTime?: string;
  sources?: Array<{ name: string; domain?: string }>;
  sourceCountText?: string;
}

export interface EditorialBriefingOptions {
  type?: 'morning' | 'evening';
  date?: string;
  recipient?: string;
  brandName?: string;
  senderEmail?: string;
  appUrl?: string;
  readingTime?: string;
  events?: BriefingEmailEvent[];
  customTitle?: string;
  customSubtitle?: string;
}

/**
 * Cache em memória para templates lidos do disco em produção / desenvolvimento
 */
const templateCache = new Map<string, string>();

/**
 * Acontecimentos ilustrativos padrão baseados no mockup editorial original
 */
const DEFAULT_FEATURED_EVENTS: BriefingEmailEvent[] = [
  {
    id: 'feat-1',
    category: 'TECNOLOGIA',
    title: 'Nvidia anuncia nova geração de chips para inteligência artificial',
    summary: 'A empresa revelou a família Blackwell Ultra, com maior capacidade de processamento e foco em data centers.',
    imageUrl: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?auto=format&fit=crop&w=400&q=80',
    relativeTime: '2h atrás',
    sources: [{ name: 'Reuters' }, { name: 'Bloomberg' }, { name: 'TechCrunch' }],
    sourceCountText: '+2 fontes'
  },
  {
    id: 'feat-2',
    category: 'ECONOMIA',
    title: 'Banco Central mantém taxa Selic em 10,50% ao ano',
    summary: 'O Copom decidiu, por unanimidade, manter a taxa básica de juros, em meio a um cenário de inflação ainda desafiador.',
    imageUrl: 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=400&q=80',
    relativeTime: '4h atrás',
    sources: [{ name: 'Valor Econômico' }, { name: 'Folha de S.Paulo' }, { name: 'Reuters' }]
  },
  {
    id: 'feat-3',
    category: 'POLÍTICA',
    title: 'Governo anuncia novo pacote de medidas fiscais',
    summary: 'O ministro da Fazenda detalhou as propostas, que incluem ajustes no gasto público e reforço na arrecadação.',
    imageUrl: 'https://images.unsplash.com/photo-1541872705-1f73d6402ec9?auto=format&fit=crop&w=400&q=80',
    relativeTime: '5h atrás',
    sources: [{ name: 'Folha de S.Paulo' }, { name: 'Estadão' }, { name: 'Reuters' }]
  },
  {
    id: 'feat-4',
    category: 'ENERGIA',
    title: 'Brasil bate recorde de investimentos em energia renovável no 1º trimestre',
    summary: 'O país atraiu US$ 12,4 bilhões em novos projetos, impulsionado pela expansão da energia solar e eólica.',
    imageUrl: 'https://images.unsplash.com/photo-1466611653911-95081537e5b7?auto=format&fit=crop&w=400&q=80',
    relativeTime: '6h atrás',
    sources: [{ name: 'Bloomberg' }, { name: 'Valor Econômico' }, { name: 'Reuters' }]
  }
];

const DEFAULT_SECONDARY_EVENTS: BriefingEmailEvent[] = [
  {
    id: 'sec-1',
    category: 'SAÚDE',
    title: 'Nova vacina contra o vírus sincicial respiratório avança em testes',
    relativeTime: '3h atrás'
  },
  {
    id: 'sec-2',
    category: 'EMPRESAS',
    title: 'Amazon anuncia investimento de US$ 4 bilhões no Brasil',
    relativeTime: '5h atrás'
  },
  {
    id: 'sec-3',
    category: 'INTERNACIONAL',
    title: 'UE discute nova política de defesa e autonomia estratégica',
    relativeTime: '6h atrás'
  }
];

/**
 * Renderiza os 4 cards principais de acontecimentos (com foto, título, resumo e fontes)
 */
export function renderFeaturedEventsHtml(eventsList: BriefingEmailEvent[], appUrl: string): string {
  const eventsToRender = eventsList && eventsList.length > 0
    ? eventsList.slice(0, 4)
    : DEFAULT_FEATURED_EVENTS;

  return eventsToRender.map((item, idx) => {
    const itemUrl = `${appUrl}/?event=${encodeURIComponent(item.id)}`;
    const category = (item.category || 'GERAL').toUpperCase();
    const sources = item.sources && item.sources.length > 0
      ? item.sources.map(s => s.name).join(' · ')
      : 'Imprensa verificada';
    const extraSources = item.sourceCountText ? ` · ${item.sourceCountText}` : '';
    const imgUrl = item.imageUrl || DEFAULT_FEATURED_EVENTS[idx % DEFAULT_FEATURED_EVENTS.length].imageUrl;
    const relTime = item.relativeTime || 'há pouco';

    return `
      <div style="background-color: #0c0d10; border: 1px solid #1f2228; border-radius: 14px; padding: 14px 16px; margin-bottom: 12px; box-sizing: border-box;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="event-card-table">
          <tr>
            <td valign="top" width="140" class="event-card-img-cell" style="padding-right: 16px; width: 140px;">
              <a href="${itemUrl}" target="_blank" style="text-decoration: none; display: block;">
                <img src="${imgUrl}" alt="${item.title}" class="event-card-img" width="140" height="92" style="width: 140px; height: 92px; border-radius: 10px; object-fit: cover; display: block; border: 0; background-color: #1a1c24;" />
              </a>
            </td>
            <td valign="middle" class="event-card-content-cell">
              <div style="font-size: 10.5px; font-weight: 700; color: #a1a1aa; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; font-family: -apple-system, BlinkMacSystemFont, monospace;">
                <span style="color: #4ade80; margin-right: 4px;">●</span> ${category}
              </div>
              <div style="margin-bottom: 5px;">
                <a href="${itemUrl}" target="_blank" style="color: #ffffff; text-decoration: none; font-size: 14.5px; font-weight: 700; line-height: 1.32; letter-spacing: -0.2px;">
                  ${item.title}
                </a>
              </div>
              <div style="font-size: 12px; color: #a1a1aa; line-height: 1.45; margin-bottom: 8px;">
                ${item.summary}
              </div>
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td valign="middle" style="font-size: 11px; color: #71717a;">
                    ${sources}${extraSources}
                  </td>
                  <td valign="middle" align="right" style="font-size: 11px; color: #71717a; white-space: nowrap;">
                    <span style="margin-right: 8px;">${relTime}</span>
                    <a href="${itemUrl}" target="_blank" style="color: #ffffff; text-decoration: none; font-size: 13px; font-weight: bold;">&rarr;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `;
  }).join('');
}

/**
 * Renderiza as linhas compactas de 'Outros Destaques'
 */
export function renderSecondaryEventsHtml(eventsList: BriefingEmailEvent[], appUrl: string): string {
  const secondaryList = eventsList && eventsList.length > 4
    ? eventsList.slice(4, 8)
    : DEFAULT_SECONDARY_EVENTS;

  return secondaryList.map((row) => {
    const itemUrl = `${appUrl}/?event=${encodeURIComponent(row.id)}`;
    const category = (row.category || 'DESTAQUE').toUpperCase();
    const relTime = row.relativeTime || 'há pouco';

    return `
      <tr>
        <td style="padding: 13px 16px; border-bottom: 1px solid #1a1c22;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td valign="middle" width="120" style="padding-right: 12px; width: 120px;">
                <span style="display: inline-block; padding: 3px 8px; background-color: #141720; border: 1px solid #232733; border-radius: 6px; font-size: 9.5px; font-weight: 700; color: #a1a1aa; font-family: -apple-system, BlinkMacSystemFont, monospace; text-transform: uppercase; letter-spacing: 0.8px;">
                  ${category}
                </span>
              </td>
              <td valign="middle">
                <a href="${itemUrl}" target="_blank" style="color: #ffffff; font-size: 12.5px; font-weight: 500; text-decoration: none; line-height: 1.35;">
                  ${row.title}
                </a>
              </td>
              <td valign="middle" align="right" width="85" style="font-size: 11px; color: #71717a; white-space: nowrap; padding-left: 10px; width: 85px;">
                <span style="margin-right: 8px;">${relTime}</span>
                <a href="${itemUrl}" target="_blank" style="color: #ffffff; text-decoration: none; font-size: 13px; font-weight: bold;">&rarr;</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Constrói o HTML editorial definitivo para o Resumo Matinal ou Resumo Noturno
 * correspondendo perfeitamente ao layout preto, branco e cinza da Sinal.
 */
export function buildEditorialBriefingHtml(options: EditorialBriefingOptions = {}): string {
  const isEvening = options.type === 'evening';
  const brandName = options.brandName || 'FatosBR';
  const senderEmail = options.senderEmail || 'noticias@fatosbr.com.br';
  const appUrl = options.appUrl || 'https://fatosbr.com.br';
  const dateFormatted = options.date || new Date().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });

  const editionTime = isEvening ? '20:00' : '07:00';
  const kicker = isEvening ? 'RESUMO NOTURNO' : 'RESUMO MATINAL';
  const editionTitle = isEvening ? 'Resumo Noturno' : 'Resumo Matinal';
  const editionName = isEvening ? 'Resumo Noturno' : 'Resumo Matinal';
  const editionSubtext = isEvening
    ? 'O fechamento do dia e a consolidação dos fatos para sua análise.'
    : 'Os principais acontecimentos do dia, selecionados para você.';

  const heroTitle = options.customTitle || (isEvening ? 'O fechamento do dia, em minutos.' : 'O essencial do mundo, em minutos.');
  const heroSubtitle = options.customSubtitle || (isEvening
    ? 'A análise completa dos fatos que moveram o Brasil e o mundo ao longo do dia, com contexto para sua tomada de decisão.'
    : 'Confira os acontecimentos mais relevantes de hoje, organizados por temas e com contexto para você entender o que realmente importa.');

  const readingTime = options.readingTime || (isEvening ? '6 min de leitura' : '7 min de leitura');
  const globeImageUrl = `${appUrl}/assets/briefing-globe.svg`;

  // Gera os cards e linhas a partir dos eventos reais
  const featuredHtml = renderFeaturedEventsHtml(options.events || [], appUrl);
  const secondaryHtml = renderSecondaryEventsHtml(options.events || [], appUrl);

  const variables: Record<string, string> = {
    title: `${brandName} • ${editionTitle} — ${dateFormatted}`,
    preheader: `${heroTitle} ${heroSubtitle}`,
    date: dateFormatted,
    edition_time: editionTime,
    edition_title: editionTitle,
    edition_name: editionName,
    edition_subtext: editionSubtext,
    kicker: kicker,
    hero_title: heroTitle,
    hero_subtitle: heroSubtitle,
    reading_time: readingTime,
    brand_name: brandName,
    sender_email: senderEmail,
    app_url: appUrl,
    globe_image_url: globeImageUrl,
    featured_events_html: featuredHtml,
    secondary_events_html: secondaryHtml
  };

  return renderEmailTemplate('briefing', variables);
}

/**
 * Função legado para manter retrocompatibilidade com endpoints existentes
 */
export function getMagnificentBriefingTemplate(
  variables: Record<string, string | number | undefined | null>
): string {
  const isEvening = String(variables.edition || variables.title || '').toLowerCase().includes('noturn') ||
    String(variables.edition || '').includes('20:00');

  return buildEditorialBriefingHtml({
    type: isEvening ? 'evening' : 'morning',
    date: variables.date ? String(variables.date) : undefined,
    recipient: variables.recipient ? String(variables.recipient) : undefined,
    appUrl: variables.app_url ? String(variables.app_url) : undefined,
    readingTime: variables.reading_time ? String(variables.reading_time) : undefined,
    customTitle: variables.title ? String(variables.title).replace(/^[^•]+•\s*/, '') : undefined,
    customSubtitle: variables.summary ? String(variables.summary) : undefined
  });
}

/**
 * Carrega e renderiza templates de e-mail a partir de /templates/emails
 */
export function renderEmailTemplate(
  templateName: string,
  variables: Record<string, string | number | undefined | null> = {}
): string {
  let templateHtml = templateCache.get(templateName);

  if (!templateHtml) {
    const templatePath = path.resolve(process.cwd(), 'templates', 'emails', `${templateName}.html`);
    try {
      if (fs.existsSync(templatePath)) {
        templateHtml = fs.readFileSync(templatePath, 'utf-8');
        templateCache.set(templateName, templateHtml);
      }
    } catch {
      // Fallback
    }
  }

  if (!templateHtml) {
    // Se o arquivo não existir, gera o fallback editorial
    templateHtml = getFallbackTemplate(templateName, variables);
  }

  // Interpolação de variáveis: {{chave}}
  let rendered = templateHtml;
  for (const [key, value] of Object.entries(variables)) {
    const stringVal = value !== undefined && value !== null ? String(value) : '';
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    rendered = rendered.replace(regex, stringVal);
  }

  // Remove {{tags}} vazias restantes
  rendered = rendered.replace(/\{\{\s*[\w.-]+\s*\}\}/g, '');

  return rendered;
}

/**
 * Fallback em caso de indisponibilidade de arquivo
 */
function getFallbackTemplate(
  templateName: string,
  variables: Record<string, string | number | undefined | null> = {}
): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #07080a; color: #ffffff; padding: 32px; border-radius: 16px; max-width: 640px; margin: 0 auto; border: 1px solid #1f2228;">
      <h1 style="color: #ffffff; font-size: 20px;">{{title}}</h1>
      <p style="color: #a1a1aa; font-size: 13px;">{{hero_subtitle}}</p>
      <div>{{featured_events_html}}</div>
      <div>{{secondary_events_html}}</div>
    </div>
  `;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Supabase Edge Function: Real News Ingestion & AI Synthesis Engine V1 (FatosBR)
 * 
 * Pipeline Real de Produção:
 * 1. Coleta concorrente dos provedores reais configurados (GNews, NewsAPI, World News API).
 * 2. Normalização estrita de dados (URLs canônicas, títulos, metadados de imprensa).
 * 3. Deduplicação determinística por URL e similaridade lexical de manchetes.
 * 4. Agrupamento factual em Acontecimentos (Event Clusters) com UUIDs RFC 4122.
 * 5. Síntese editorial com IA via NVIDIA NIM (quando configurada) ou sumarização determinística.
 * 6. Persistência canônica no Supabase (public.events, public.articles, public.news_sources, public.event_articles).
 * 7. ZERO matérias inventadas ou mockadas.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface IngestedArticle {
  id: string;
  title: string;
  snippet: string;
  sourceName: string;
  domain: string;
  url: string;
  publishedAt: string;
  category: string;
  imageUrl?: string;
}

export interface EventCluster {
  id: string;
  title: string;
  summary: string;
  whatHappened: string;
  whyItMatters: string;
  category: string;
  relevanceScore: number;
  imageUrl?: string;
  publishedAt: string;
  articles: IngestedArticle[];
}

/**
 * Gera um UUID RFC 4122 v4 determinístico baseado numa seed estável.
 */
function generateDeterministicUuid(seed: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  let h3 = 0x12345678, h4 = 0x87654321;
  for (let i = seed.length - 1; i >= 0; i--) {
    const ch = seed.charCodeAt(i);
    h3 = Math.imul(h3 ^ ch, 2246822507);
    h4 = Math.imul(h4 ^ ch, 3266489909);
  }

  const hex = [h1, h2, h3, h4]
    .map(n => (n >>> 0).toString(16).padStart(8, '0'))
    .join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const {
      keywords = ["brasil", "economia", "tecnologia"],
      dryRun = false,
      runAiSynthesis = true,
      maxPerProvider = 10
    } = body;

    // Chaves de ambiente do Supabase / Edge Function
    const gnewsKey = Deno.env.get("GNEWS_API_KEY") || "";
    const newsapiKey = Deno.env.get("NEWSAPI_API_KEY") || "";
    const worldnewsKey = Deno.env.get("WORLD_NEWS_API_KEY") || "";
    const nvidiaKey = Deno.env.get("NVIDIA_NIM_API_KEY") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const providerStats: Record<string, { configured: boolean; fetched: number; error?: string }> = {
      gnews: { configured: Boolean(gnewsKey), fetched: 0 },
      newsapi: { configured: Boolean(newsapiKey), fetched: 0 },
      worldnews: { configured: Boolean(worldnewsKey), fetched: 0 },
      nvidia: { configured: Boolean(nvidiaKey), fetched: 0 }
    };

    const rawArticles: IngestedArticle[] = [];

    // 1. Coleta concorrente dos provedores reais
    const fetchPromises: Promise<void>[] = [];

    // GNews API
    if (gnewsKey) {
      for (const kw of keywords.slice(0, 2)) {
        fetchPromises.push(
          (async () => {
            try {
              const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(kw)}&lang=pt&country=br&max=${maxPerProvider}&apikey=${gnewsKey}`;
              const res = await fetch(url);
              if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.articles)) {
                  data.articles.forEach((art: any, idx: number) => {
                    let domain = 'gnews.io';
                    try {
                      domain = new URL(art.url).hostname.replace('www.', '');
                    } catch {
                      domain = art.source?.name || 'Fonte Verificada';
                    }
                    rawArticles.push({
                      id: `gnews-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
                      title: (art.title || '').trim(),
                      snippet: (art.description || art.content || art.title || '').trim(),
                      sourceName: art.source?.name || domain,
                      domain,
                      url: art.url,
                      publishedAt: art.publishedAt || new Date().toISOString(),
                      category: detectCategory(art.title || '', art.description || ''),
                      imageUrl: art.image || undefined
                    });
                  });
                  providerStats.gnews.fetched += data.articles.length;
                }
              } else {
                providerStats.gnews.error = `HTTP ${res.status}`;
              }
            } catch (err: any) {
              providerStats.gnews.error = err?.message || 'Erro de rede';
            }
          })()
        );
      }
    }

    // NewsAPI
    if (newsapiKey) {
      for (const kw of keywords.slice(0, 2)) {
        fetchPromises.push(
          (async () => {
            try {
              const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(kw)}&pageSize=${maxPerProvider}&apiKey=${newsapiKey}`;
              const res = await fetch(url, {
                headers: { 'User-Agent': 'FatosBR-News-Engine-Edge/1.0' }
              });
              if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.articles)) {
                  data.articles.forEach((art: any, idx: number) => {
                    if (!art.title || art.title.includes('[Removed]')) return;
                    let domain = 'newsapi.org';
                    try {
                      domain = new URL(art.url).hostname.replace('www.', '');
                    } catch {
                      domain = art.source?.name || 'Notícias';
                    }
                    rawArticles.push({
                      id: `newsapi-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
                      title: (art.title || '').trim(),
                      snippet: (art.description || art.content || art.title || '').trim(),
                      sourceName: art.source?.name || domain,
                      domain,
                      url: art.url,
                      publishedAt: art.publishedAt || new Date().toISOString(),
                      category: detectCategory(art.title || '', art.description || ''),
                      imageUrl: art.urlToImage || undefined
                    });
                  });
                  providerStats.newsapi.fetched += data.articles.length;
                }
              } else {
                providerStats.newsapi.error = `HTTP ${res.status}`;
              }
            } catch (err: any) {
              providerStats.newsapi.error = err?.message || 'Erro de rede';
            }
          })()
        );
      }
    }

    // World News API
    if (worldnewsKey) {
      fetchPromises.push(
        (async () => {
          try {
            const url = `https://api.worldnewsapi.com/search-news?text=brasil&language=pt&number=${maxPerProvider}&api-key=${worldnewsKey}`;
            const res = await fetch(url);
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data.news)) {
                data.news.forEach((item: any, idx: number) => {
                  let domain = 'worldnewsapi.com';
                  try {
                    domain = new URL(item.url).hostname.replace('www.', '');
                  } catch {
                    domain = 'Imprensa Global';
                  }
                  rawArticles.push({
                    id: `worldnews-${item.id || Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
                    title: (item.title || '').trim(),
                    snippet: (item.text || item.title || '').slice(0, 300),
                    sourceName: domain.split('.')[0].toUpperCase(),
                    domain,
                    url: item.url,
                    publishedAt: item.publish_date || new Date().toISOString(),
                    category: detectCategory(item.title || '', item.text || ''),
                    imageUrl: item.image || undefined
                  });
                });
                providerStats.worldnews.fetched += data.news.length;
              }
            } else {
              providerStats.worldnews.error = `HTTP ${res.status}`;
            }
          } catch (err: any) {
            providerStats.worldnews.error = err?.message || 'Erro de rede';
          }
        })()
      );
    }

    await Promise.allSettled(fetchPromises);

    // 2. Deduplicação estrita por URL canônica e hash lexical do título
    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>();
    const deduplicatedArticles: IngestedArticle[] = [];

    for (const art of rawArticles) {
      if (!art.url || !art.title || art.title.length < 8) continue;
      const cleanUrl = art.url.split('?')[0].toLowerCase();
      const normTitle = art.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32);

      if (seenUrls.has(cleanUrl) || seenTitles.has(normTitle)) continue;
      seenUrls.add(cleanUrl);
      seenTitles.add(normTitle);
      deduplicatedArticles.push(art);
    }

    // 3. Agrupamento em Acontecimentos (Event Clusters)
    const clusters: EventCluster[] = [];
    const usedIndices = new Set<number>();

    for (let i = 0; i < deduplicatedArticles.length; i++) {
      if (usedIndices.has(i)) continue;
      const primary = deduplicatedArticles[i];
      usedIndices.add(i);

      const clusterArticles: IngestedArticle[] = [primary];
      const primaryWords = new Set(
        primary.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 4)
      );

      for (let j = i + 1; j < deduplicatedArticles.length; j++) {
        if (usedIndices.has(j)) continue;
        const candidate = deduplicatedArticles[j];

        if (candidate.category === primary.category) {
          const candidateWords = candidate.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 4);
          const sharedWords = candidateWords.filter((w) => primaryWords.has(w));
          if (sharedWords.length >= 2) {
            clusterArticles.push(candidate);
            usedIndices.add(j);
          }
        }
      }

      // 4. Síntese editorial (IA ou Factual Determinística)
      let title = primary.title;
      let summary = primary.snippet;
      let whatHappened = clusterArticles.map((a) => `• ${a.title} (${a.sourceName})`).join('\n');
      let whyItMatters = `A apuração confirmada por ${clusterArticles.length} fontes independentes traz impactos relevantes para ${primary.category}.`;
      let relevanceScore = Math.min(98, 86 + clusterArticles.length * 3);

      if (nvidiaKey && runAiSynthesis && !dryRun && clusterArticles.length >= 2) {
        try {
          const aiRes = await callNvidiaSynthesis(nvidiaKey, clusterArticles, primary.category);
          if (aiRes) {
            if (aiRes.title) title = aiRes.title;
            if (aiRes.summary) summary = aiRes.summary;
            if (aiRes.whatHappened) whatHappened = aiRes.whatHappened;
            if (aiRes.whyItMatters) whyItMatters = aiRes.whyItMatters;
            if (aiRes.relevanceScore) relevanceScore = aiRes.relevanceScore;
          }
        } catch {
          // Fallback gracioso
        }
      }

      const clusterSeed = `evt:${primary.category}:${primary.title.toLowerCase().slice(0, 30)}`;
      const eventUuid = generateDeterministicUuid(clusterSeed);

      clusters.push({
        id: eventUuid,
        title,
        summary: summary.length > 240 ? summary.slice(0, 240) + '...' : summary,
        whatHappened,
        whyItMatters,
        category: primary.category,
        relevanceScore,
        imageUrl: primary.imageUrl || getCategoryFallbackImage(primary.category),
        publishedAt: primary.publishedAt,
        articles: clusterArticles
      });
    }

    // 5. Persistência real no Supabase nas tabelas canônicas de produção
    let eventsPersisted = 0;
    let sourcesPersisted = 0;
    let articlesPersisted = 0;

    if (supabaseUrl && serviceRoleKey && !dryRun && clusters.length > 0) {
      const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false }
      });

      for (const cl of clusters) {
        // Upsert Evento em public.events (schema canônico)
        const { error: evtErr } = await supabase.from('events').upsert({
          id: cl.id,
          title: cl.title,
          summary: cl.summary,
          published_at: cl.publishedAt,
          updated_at: new Date().toISOString(),
          relevance_score: cl.relevanceScore
        }, { onConflict: 'id' });

        if (!evtErr) {
          eventsPersisted++;

          // Upsert Fontes em public.news_sources e Matérias em public.articles
          for (const art of cl.articles) {
            const sourceUuid = generateDeterministicUuid(`src:${art.domain}`);
            const articleUuid = generateDeterministicUuid(`art:${art.url}`);

            // Upsert fonte em public.news_sources
            await supabase.from('news_sources').upsert({
              id: sourceUuid,
              name: art.sourceName,
              domain: art.domain,
              category: art.category,
              brand_color: '#64748b'
            }, { onConflict: 'domain' });
            sourcesPersisted++;

            // Upsert artigo em public.articles
            await supabase.from('articles').upsert({
              id: articleUuid,
              title: art.title,
              url: art.url,
              snippet: art.snippet || art.title,
              source_id: sourceUuid,
              image_url: art.imageUrl || null,
              category: art.category,
              published_at: art.publishedAt
            }, { onConflict: 'url' });
            articlesPersisted++;

            // Vincular em public.event_articles
            await supabase.from('event_articles').upsert({
              event_id: cl.id,
              article_id: articleUuid
            }, { onConflict: 'event_id,article_id' });
          }
        }
      }
    }

    const durationMs = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        status: "success",
        pipeline: "FatosBR News Engine V1 (Real Canonical Schema)",
        dryRun,
        durationMs,
        stats: {
          articlesFetched: rawArticles.length,
          deduplicatedCount: deduplicatedArticles.length,
          clustersIdentified: clusters.length,
          eventsPersisted,
          sourcesPersisted,
          articlesPersisted
        },
        providers: providerStats,
        clusters: dryRun ? clusters.slice(0, 5) : undefined,
        generatedAt: new Date().toISOString()
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        status: "error",
        error: err?.message || "Falha na execução do pipeline de ingestão",
        durationMs: Date.now() - startTime
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

/**
 * Chamada à NVIDIA NIM para síntese editorial com defesas anti-prompt injection
 */
async function callNvidiaSynthesis(
  apiKey: string,
  articles: IngestedArticle[],
  category: string
): Promise<{
  title?: string;
  summary?: string;
  whatHappened?: string;
  whyItMatters?: string;
  relevanceScore?: number;
} | null> {
  const sanitizedContext = articles
    .slice(0, 4)
    .map(
      (a, i) =>
        `[Fonte ${i + 1}: ${a.sourceName.replace(/[\r\n]/g, ' ')}]\n` +
        `Título: ${a.title.replace(/[\r\n]/g, ' ')}\n` +
        `Trecho: ${a.snippet.replace(/[\r\n]/g, ' ').slice(0, 200)}`
    )
    .join('\n\n');

  const prompt =
    `Você é o editor do FatosBR. Analise os artigos apurados abaixo sobre o mesmo fato e produza uma síntese jornalística neutra em JSON:\n\n` +
    `${sanitizedContext}\n\n` +
    `Retorne EXCLUSIVAMENTE um objeto JSON com as chaves:\n` +
    `"title": título conciso e factual\n` +
    `"summary": resumo executivo de 2 frases\n` +
    `"whatHappened": 2 a 3 tópicos iniciando com "• "\n` +
    `"whyItMatters": impacto concreto em 1 frase\n` +
    `"relevanceScore": número inteiro entre 85 e 98`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 600
      })
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    const cleanJson = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJson);
  } catch {
    return null;
  }
}

function detectCategory(title: string, snippet: string): string {
  const text = `${title} ${snippet}`.toLowerCase();
  if (text.includes('ia') || text.includes('inteligência artificial') || text.includes('tecnologia') || text.includes('apple') || text.includes('google') || text.includes('software') || text.includes('nvidia') || text.includes('semicondutor') || text.includes('openai')) {
    return 'Tecnologia & IA';
  }
  if (text.includes('dólar') || text.includes('inflação') || text.includes('selic') || text.includes('juros') || text.includes('banco') || text.includes('mercado') || text.includes('ibovespa') || text.includes('economia') || text.includes('ações')) {
    return 'Economia';
  }
  if (text.includes('lula') || text.includes('stf') || text.includes('senado') || text.includes('congresso') || text.includes('governo') || text.includes('política') || text.includes('lei') || text.includes('pec')) {
    return 'Política';
  }
  if (text.includes('futebol') || text.includes('copa') || text.includes('gol') || text.includes('seleção') || text.includes('flamengo') || text.includes('campeonato')) {
    return 'Esportes';
  }
  if (text.includes('escola') || text.includes('professor') || text.includes('saúde') || text.includes('clima') || text.includes('meio ambiente') || text.includes('educação') || text.includes('sus')) {
    return 'Educação & Sociedade';
  }
  return 'Brasil & Atualidades';
}

function getCategoryFallbackImage(category: string): string {
  switch (category) {
    case 'Tecnologia & IA':
      return 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80';
    case 'Economia':
      return 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80';
    case 'Política':
      return 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=1200&q=80';
    case 'Esportes':
      return 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=1200&q=80';
    case 'Educação & Sociedade':
      return 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?auto=format&fit=crop&w=1200&q=80';
    default:
      return 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80';
  }
}

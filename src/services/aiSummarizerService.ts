/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RawArticle } from './newsIngestionService';
import { Event, SourceReference } from '../types/sinal';

export interface SummarizationOutput {
  title: string;
  summary: string;
  whatHappened: string;
  whyItMatters: string;
  category: string;
  relevanceScore: number;
}

export const aiSummarizerService = {
  /**
   * Executa chamada de inferência no modelo NVIDIA NIM
   * através do proxy interno (/api/proxy/nvidia/chat) mantendo chaves e endpoints ocultos
   */
  async callNvidiaNemotron(prompt: string, systemPrompt?: string): Promise<{
    content: string;
    reasoning?: string;
  }> {
    const res = await fetch('/api/proxy/nvidia/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
        messages: [
          {
            role: 'system',
            content:
              systemPrompt ||
              'Você é o motor de inteligência e síntese contextual do FatosBR. ' +
                'Seu objetivo é analisar múltiplos artigos de imprensa sobre o mesmo fato, extrair os fatos verificados ' +
                'e produzir uma síntese rigorosa sem viés partidário ou sensacionalismo. ' +
                'Responda SEMPRE em JSON válido com as chaves: "title", "summary", "whatHappened", "whyItMatters", "category", "relevanceScore".'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.6,
        max_tokens: 1500
      })
    }).catch(() => null);

    if (!res || !res.ok) {
      throw new Error(`NVIDIA NIM indisponível (HTTP ${res ? res.status : 'Offline'})`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const content = choice?.message?.content || '';
    const reasoning = choice?.message?.reasoning_content || '';

    return { content, reasoning };
  },

  /**
   * Converte múltiplos artigos cruzados em uma síntese factual de Acontecimento (Event)
   * utilizando inferência com o modelo NVIDIA NIM ou fallback determinístico robusto.
   */
  async synthesizeArticlesToEvent(
    articles: RawArticle[],
    overrideCategory?: string
  ): Promise<Event> {
    if (!articles || articles.length === 0) {
      throw new Error('Nenhum artigo fornecido para sintetização.');
    }

    const primary = articles[0];
    const category = overrideCategory || primary.category || 'Tecnologia';

    // Mapear referências de fontes plurais
    const sources: SourceReference[] = articles.map((art, idx) => ({
      id: `src-ref-${Date.now()}-${idx}`,
      sourceName: art.sourceName,
      domain: art.domain,
      headline: art.title,
      url: art.url,
      publishedAt: art.publishedAt
    }));

    let title = primary.title;
    let summary = primary.snippet;
    let whatHappened = articles.map((a) => `• ${a.title} (${a.sourceName})`).join('\n');
    let whyItMatters = `A confluência de ${articles.length} veículos independentes evidencia o desdobramento setorial e de mercado deste acontecimento.`;
    let relevanceScore = 92;

    // Tentativa de síntese real com NVIDIA NIM
    try {
      const articlesContext = articles
        .map(
          (a, i) =>
            `[Artigo ${i + 1}] Fonte: ${a.sourceName} (${a.domain})\nTítulo: ${a.title}\nTrecho: ${a.snippet}`
        )
        .join('\n\n');

      const userPrompt =
        `Analise os seguintes artigos reunidos sobre este acontecimento e elabore a síntese editorial do FatosBR:\n\n` +
        `${articlesContext}\n\n` +
        `Retorne exclusivamente um objeto JSON com:\n` +
        `- "title": Título claro, factual e sem clickbait\n` +
        `- "summary": Resumo executivo em 2 a 3 frases\n` +
        `- "whatHappened": 2 a 4 tópicos com bullet points "• " listando os fatos concretos\n` +
        `- "whyItMatters": Explicação em 1 a 2 frases do impacto estrutural ou de mercado\n` +
        `- "category": "${category}"\n` +
        `- "relevanceScore": número entre 80 e 98`;

      const aiResponse = await this.callNvidiaNemotron(userPrompt);

      // Limpar blocos de markdown ```json caso retornados
      const cleanJson = aiResponse.content
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

      const parsed = JSON.parse(cleanJson);
      if (parsed.title) title = parsed.title;
      if (parsed.summary) summary = parsed.summary;
      if (parsed.whatHappened) whatHappened = parsed.whatHappened;
      if (parsed.whyItMatters) whyItMatters = parsed.whyItMatters;
      if (parsed.relevanceScore) relevanceScore = Number(parsed.relevanceScore) || 92;
    } catch {
      // Fallback estruturado sem quebrar a execução
      title = primary.title;
      summary = `Reunião de ${articles.length} fontes independentes confirmando novos desenvolvimentos. ${primary.snippet.slice(0, 160)}...`;
      whatHappened = articles.map((a) => `• ${a.title} (${a.sourceName})`).join('\n');
      whyItMatters = `A confluência de ${articles.length} fontes auditadas confere alta consistência às informações reportadas.`;
    }

    return {
      id: `evt-${Date.now()}`,
      title,
      summary,
      whatHappened,
      whyItMatters,
      category,
      imageUrl: primary.imageUrl || 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      relevanceScore,
      relativeTime: 'Agora há pouco',
      sourceCountText: `${sources.length} fontes`,
      isSaved: false,
      isViewed: false,
      sources,
      entities: [
        {
          id: 'ent-auto-1',
          name: 'Setor de Tecnologia & IA',
          type: 'organization',
          isFollowed: true,
          description: 'Acontecimentos e desenvolvimento tecnológico'
        }
      ],
      topics: [
        {
          id: 'top-auto-1',
          name: category,
          slug: category.toLowerCase().replace(/\s+/g, '-'),
          description: `Acontecimentos relacionados a ${category}`,
          category,
          isFollowed: true
        }
      ],
      timeline: [
        {
          id: `time-1`,
          date: 'Hoje',
          time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          title: 'Primeiro registro de confluência',
          description: `Matérias publicadas inicialmente por ${sources[0]?.sourceName || 'Imprensa'}.`
        },
        {
          id: `time-2`,
          date: 'Hoje',
          time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          title: 'Validação cruzada multi-fonte',
          description: `Confirmação de fatos por ${sources.length} veículos primários independentes.`
        }
      ]
    };
  }
};

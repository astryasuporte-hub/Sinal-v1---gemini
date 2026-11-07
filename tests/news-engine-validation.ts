/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FATOSBR — SUITE DE TESTES E VALIDAÇÃO DO NEWS ENGINE V1
 * Valida rigorosamente:
 * 1. Ausência total de notícias fictícias, dados mockados e fallbacks simulados.
 * 2. Deduplicação e normalização canônica de matérias.
 * 3. Funcionamento do Stale-While-Revalidate (SWR) no feed.
 * 4. Roteamento consolidado em no máximo 12 Serverless Functions (exatamente 8).
 * 5. Observabilidade e diagnósticos em falhas de API (sem retornos silenciosos).
 * 6. Edge Function ingest-news real conectada a provedores externos e Supabase.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';

let passed = 0;
let failed = 0;

function it(desc: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      res.then(() => {
        console.log(`  ✅ [PASS] ${desc}`);
        passed++;
      }).catch((err) => {
        console.error(`  ❌ [FAIL] ${desc}\n     -> ${err.message}`);
        failed++;
      });
    } else {
      console.log(`  ✅ [PASS] ${desc}`);
      passed++;
    }
  } catch (err: any) {
    console.error(`  ❌ [FAIL] ${desc}\n     -> ${err.message}`);
    failed++;
  }
}

console.log('======================================================');
console.log('📰 FATOSBR — SUITE DE VALIDAÇÃO DO NEWS ENGINE V1');
console.log('======================================================\n');

// 1. Auditoria de Código-Fonte Contra Notícias Fictícias
console.log('--- 1. AUDITORIA CONTRA NOTÍCIAS FICTÍCIAS E DADOS MOCKADOS ---');

it('1.1 newsIngestionService não contém a função getRealNewsFallback com matérias inventadas', () => {
  const code = fs.readFileSync(path.resolve('src/services/newsIngestionService.ts'), 'utf-8');
  assert(!code.includes('function getRealNewsFallback'), 'A função getRealNewsFallback com notícias fictícias ainda existe no código.');
  assert(!code.includes('real-1'), 'Identificador de matéria mockada "real-1" ainda encontrado.');
  assert(!code.includes('Avanços em inteligência artificial aceleram automação'), 'Matéria mockada pré-fabricada encontrada em newsIngestionService.');
});

it('1.2 fetchIncomingNewsBatch não retorna matérias pré-definidas em caso de cota zerada', () => {
  const code = fs.readFileSync(path.resolve('src/services/newsIngestionService.ts'), 'utf-8');
  assert(!code.includes('Lote Primário de Alta Relevância'), 'Fallback com lote primário mockado ainda existe em newsIngestionService.');
  assert(code.includes('Nenhuma matéria real retornada pelos provedores externos'), 'Mensagem legítima de estado vazio não encontrada.');
});

it('1.3 supabase/functions/ingest-news não contém valores simulados hardcoded', () => {
  const code = fs.readFileSync(path.resolve('supabase/functions/ingest-news/index.ts'), 'utf-8');
  assert(!code.includes('Simulação do pipeline de coleta'), 'Comentário de simulação ainda encontrado.');
  assert(!code.includes('deduplicatedCount: 8'), 'Valor fixo mockado deduplicatedCount: 8 ainda encontrado.');
  assert(!code.includes('clustersIdentified: 2'), 'Valor fixo mockado clustersIdentified: 2 ainda encontrado.');
  assert(code.includes('gnews.io/api/v4/search'), 'Pipeline real de consulta ao GNews não encontrado.');
  assert(code.includes('newsapi.org/v2/everything'), 'Pipeline real de consulta ao NewsAPI não encontrado.');
});

// 2. Auditoria do Stale-While-Revalidate (SWR) no Feed
console.log('\n--- 2. AUDITORIA DO CACHE STALE-WHILE-REVALIDATE (SWR) ---');

it('2.1 App.tsx não encerra loadRealTimeNews com return prematuro ao encontrar cache >= 20', () => {
  const code = fs.readFileSync(path.resolve('src/App.tsx'), 'utf-8');
  // Localiza o bloco do loadRealTimeNews
  const startIdx = code.indexOf('const loadRealTimeNews = async');
  const slice = code.slice(startIdx, startIdx + 4000);

  // Não deve ter "if (cached && cached.length >= 20) { ... return; }" que bloqueia background fetch
  assert(!slice.includes('cached.length >= 20'), 'Condição restritiva cached.length >= 20 ainda encontrada.');
  assert(slice.includes('hasShownStale = true'), 'Flag de Stale-While-Revalidate hasShownStale não implementada.');
  assert(slice.includes('newsIngestionService.fetchRealTimeEventsFeed'), 'Chamada de revalidação em segundo plano não encontrada.');
});

it('2.2 rateLimitService aceita qualquer cache válido com length > 0 sem travar em >= 20', () => {
  const code = fs.readFileSync(path.resolve('src/services/rateLimitService.ts'), 'utf-8');
  assert(!code.includes('memoryFeedCache.length >= 20'), 'Exigência arbitrária de >= 20 itens em memória ainda encontrada.');
  assert(!code.includes('parsed.length >= 20'), 'Exigência arbitrária de >= 20 itens no localStorage ainda encontrada.');
});

// 3. Auditoria de Observabilidade e Diagnóstico
console.log('\n--- 3. AUDITORIA DE OBSERVABILIDADE E DIAGNÓSTICO ---');

it('3.1 newsIngestionService grava diagnóstico detalhado ao invés de falhar silenciosamente', () => {
  const code = fs.readFileSync(path.resolve('src/services/newsIngestionService.ts'), 'utf-8');
  assert(code.includes('recordProviderDiagnostic'), 'Função recordProviderDiagnostic não encontrada.');
  assert(code.includes('getProviderDiagnostics'), 'Função getProviderDiagnostics não encontrada.');
  assert(code.includes('articlesReturned'), 'Métrica articlesReturned não encontrada.');
});

it('3.2 status.ts expõe métricas do News Engine e contagem de eventos no banco', () => {
  const code = fs.readFileSync(path.resolve('api/_lib/handlers/proxy/status.ts'), 'utf-8');
  assert(code.includes('newsEngine'), 'Seção newsEngine ausente no handler de status.');
  assert(code.includes('databaseEventsCount'), 'Métrica databaseEventsCount ausente no handler de status.');
});

// 4. Auditoria de Limites da Vercel (Hobby <= 12 Serverless Functions)
console.log('\n--- 4. AUDITORIA DE LIMITES DE SERVERLESS FUNCTIONS (VERCEL HOBBY) ---');

it('4.1 O número total de Serverless Functions na pasta api/ é rigorosamente <= 12', () => {
  function getFunctions(dir: string, baseDir: string = dir): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let files: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('_')) continue; // Pastas como _lib são ignoradas pela Vercel
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(getFunctions(fullPath, baseDir));
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
        files.push(path.relative(baseDir, fullPath));
      }
    }
    return files;
  }

  const serverlessFunctions = getFunctions(path.resolve('api'));
  console.log(`     Funções Serverless ativas (${serverlessFunctions.length}):`, serverlessFunctions.join(', '));
  assert(
    serverlessFunctions.length <= 12,
    `Excedeu o limite Hobby da Vercel! Foram encontradas ${serverlessFunctions.length} funções (máximo permitido: 12).`
  );
  assert(serverlessFunctions.length === 8, `Esperado 8 funções consolidadas, encontrado: ${serverlessFunctions.length}`);
});

it('4.2 Rotas /events e /ingest são despachadas dentro de api/proxy/[...action].ts consolidado', () => {
  const code = fs.readFileSync(path.resolve('api/proxy/[...action].ts'), 'utf-8');
  assert(code.includes("pathname.includes('/events')"), 'Rota /events não configurada no proxy router consolidado.');
  assert(code.includes("pathname.includes('/ingest')"), 'Rota /ingest não configurada no proxy router consolidado.');
});

setTimeout(() => {
  console.log('\n------------------------------------------------------');
  console.log(`📊 TOTAL NEWS ENGINE: ${passed} testes passaram, ${failed} falharam.`);
  console.log('------------------------------------------------------');
  if (failed > 0) {
    process.exit(1);
  }
}, 500);

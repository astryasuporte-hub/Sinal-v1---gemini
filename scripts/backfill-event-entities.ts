/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Script operacional de backfill incremental para public.event_entities.
 * Por padrão executa em modo DRY-RUN (--dry-run) e nunca inventa entidades fora de public.entities.
 *
 * Uso:
 *   npx tsx scripts/backfill-event-entities.ts --dry-run --limit=250
 *   npx tsx scripts/backfill-event-entities.ts --apply --batch-size=50 --limit=500
 */

import { executeSql, isPostgresConfigured, closePostgresPool } from '../api/_lib/postgres.js';
import { backfillEventEntities } from '../api/_lib/entityMatcher.js';

function parseArgFlag(prefix: string): string | null {
  const found = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return found ? found.slice(prefix.length + 1) : null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;
  const batchSize = Number(parseArgFlag('--batch-size') || '50');
  const limit = Number(parseArgFlag('--limit') || '500');
  const onlyMissing = !process.argv.includes('--all');

  if (!isPostgresConfigured()) {
    console.error('[Backfill event_entities] DATABASE_URL / SUPABASE_DATABASE_URL não configurado.');
    process.exit(1);
  }

  console.log(
    `[Backfill event_entities] Iniciando em modo ${dryRun ? 'DRY-RUN' : 'APPLY'} (batchSize=${batchSize}, limit=${limit}, onlyMissing=${onlyMissing})...`
  );

  try {
    const result = await backfillEventEntities({
      queryFn: (sql, params) => executeSql(sql, params),
      batchSize,
      limit,
      dryRun,
      onlyMissing,
    });
    console.log('[Backfill event_entities] Resultado:', JSON.stringify(result, null, 2));
  } finally {
    await closePostgresPool();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[Backfill event_entities] Erro fatal:', err?.message || err);
    process.exit(1);
  });
}

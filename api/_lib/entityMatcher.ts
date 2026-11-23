/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR V2.4.1 — Motor Determinístico de Matching de Entidades Reais
 *
 * Regras estritas:
 * 1. Vincula acontecimentos APENAS a entidades reais já registradas em public.entities
 *    (e seus aliases oficiais em public.entity_aliases). Nunca inventa novas entidades.
 * 2. Correspondência por fronteiras de palavra/token após normalização unicode,
 *    com proteção contra falsos positivos em siglas curtas (<= 3 chars exigem caixa alta).
 * 3. Persistência idempotente em public.event_entities (ON CONFLICT DO NOTHING)
 *    e backfill incremental seguro por lotes.
 */

export interface EntityCatalogEntry {
  id: string;
  name: string;
  slug?: string | null;
  type?: string | null;
  aliases?: string[];
}

export interface CompiledEntityMatcher {
  entityId: string;
  name: string;
  patterns: Array<{
    normalizedTerm: string;
    originalTerm: string;
    requireCaseSensitive: boolean;
    regex: RegExp;
  }>;
}

const STOPWORD_ALIASES = new Set([
  'para', 'como', 'mais', 'sobre', 'entre', 'apos', 'antes', 'contra',
  'brasil', 'governo', 'estado', 'mercado', 'grupo', 'banco', 'rede', 'nova', 'novo',
]);

const AMBIGUOUS_COMMON_WORD_PROPER_NOUNS = new Set([
  'vale', 'azul', 'vivo', 'brava', 'aura', 'soma', 'casa',
]);

const LEGAL_SUFFIX_REGEX = /(?:^|\s)(s\.?a\.?|ltda\.?|inc\.?|corp\.?|llc|plc|s\/a)(?=\s|$|[.,;:])/gi;

function stripLegalSuffixes(raw: string): string {
  return String(raw || '')
    .replace(LEGAL_SUFFIX_REGEX, ' ')
    .replace(/[.,;:\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeEntityText(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`´]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSafeDerivedCandidate(rawTerm: string): boolean {
  const clean = String(rawTerm || '').trim();
  if (!clean) return false;
  const norm = normalizeEntityText(clean);
  if (norm.length >= 4) return true;
  return /^[A-Z0-9]{2,5}$/.test(clean);
}

function deriveCandidateTerms(entry: EntityCatalogEntry): Array<{ original: string; normalized: string }> {
  const seen = new Set<string>();
  const terms: Array<{ original: string; normalized: string }> = [];

  const addTerm = (rawTerm: string) => {
    const clean = String(rawTerm || '').trim();
    if (!clean) return;
    const norm = normalizeEntityText(clean);
    if (!norm || norm.length < 2) return;
    if (STOPWORD_ALIASES.has(norm)) return;
    if (seen.has(norm)) return;
    seen.add(norm);
    terms.push({ original: clean, normalized: norm });
  };

  addTerm(entry.name);

  // Variação segura sem sufixo societário (ex: "Petrobras S.A." -> "Petrobras", "B3 S.A." -> "B3")
  const strippedLegal = stripLegalSuffixes(entry.name);
  if (strippedLegal && strippedLegal !== entry.name && isSafeDerivedCandidate(strippedLegal)) {
    addTerm(strippedLegal);
  }

  // Variação segura sem parênteses (ex: "Supremo Tribunal Federal (STF)" -> "Supremo Tribunal Federal")
  const withoutParens = String(entry.name || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutParens && withoutParens !== entry.name && isSafeDerivedCandidate(withoutParens)) {
    addTerm(withoutParens);
    const strippedParensLegal = stripLegalSuffixes(withoutParens);
    if (strippedParensLegal && strippedParensLegal !== withoutParens && isSafeDerivedCandidate(strippedParensLegal)) {
      addTerm(strippedParensLegal);
    }
  }

  // Conteúdo entre parênteses como sigla explícita no nome oficial (ex: "Banco Central (BC)" -> "BC")
  const parenMatches = String(entry.name || '').match(/\(([A-Za-z0-9À-ÿ.\-\s]{2,20})\)/g) || [];
  for (const m of parenMatches) {
    addTerm(m.slice(1, -1));
  }

  for (const alias of entry.aliases || []) {
    addTerm(alias);
  }

  return terms;
}

export function compileEntityMatchers(catalog: EntityCatalogEntry[]): CompiledEntityMatcher[] {
  const matchers: CompiledEntityMatcher[] = [];

  for (const entry of catalog) {
    if (!entry?.id || !entry?.name) continue;
    const terms = deriveCandidateTerms(entry);
    const patterns: CompiledEntityMatcher['patterns'] = [];

    for (const term of terms) {
      const tokens = term.normalized.split(' ').filter(Boolean);
      const trimmedOrig = term.original.trim();
      // Termos curtos (1 token com <= 3 chars) exigem correspondência case-sensitive no texto original (siglas como STF, BC, B3)
      const isShortSingleToken = tokens.length === 1 && term.normalized.length <= 3;
      const isAcronymOriginal = /^[A-Z0-9]{2,5}$/.test(trimmedOrig);
      const isAmbiguousProperNoun =
        tokens.length === 1 && AMBIGUOUS_COMMON_WORD_PROPER_NOUNS.has(term.normalized);

      if (isShortSingleToken && !isAcronymOriginal) {
        // Evita falsos positivos com termos curtos genéricos em minúsculo (ex: "gol", "via", "oi")
        continue;
      }

      if (isShortSingleToken && isAcronymOriginal) {
        const escapedOrig = escapeRegExp(trimmedOrig);
        patterns.push({
          normalizedTerm: term.normalized,
          originalTerm: trimmedOrig,
          requireCaseSensitive: true,
          regex: new RegExp(`(^|[^A-Za-z0-9À-ÿ])${escapedOrig}($|[^A-Za-z0-9À-ÿ])`),
        });
      } else if (isAmbiguousProperNoun) {
        // Nomes próprios idênticos a palavras comuns em português (ex: "Vale" vs "vale-transporte") exigem inicial maiúscula
        const capForm = trimmedOrig.charAt(0).toUpperCase() + trimmedOrig.slice(1).toLowerCase();
        const upperForm = trimmedOrig.toUpperCase();
        const variants = Array.from(new Set([trimmedOrig, capForm, upperForm])).map(escapeRegExp);
        patterns.push({
          normalizedTerm: term.normalized,
          originalTerm: trimmedOrig,
          requireCaseSensitive: true,
          regex: new RegExp(`(^|[^A-Za-z0-9À-ÿ])(?:${variants.join('|')})($|[^A-Za-z0-9À-ÿ])`),
        });
      } else {
        const escapedNorm = escapeRegExp(term.normalized);
        patterns.push({
          normalizedTerm: term.normalized,
          originalTerm: term.original,
          requireCaseSensitive: false,
          regex: new RegExp(`(^|[^a-z0-9])${escapedNorm}($|[^a-z0-9])`),
        });
      }
    }

    if (patterns.length > 0) {
      matchers.push({
        entityId: String(entry.id),
        name: entry.name,
        patterns,
      });
    }
  }

  return matchers;
}

export function matchCompiledEntities(
  rawText: string,
  matchers: CompiledEntityMatcher[]
): string[] {
  const original = String(rawText || '');
  if (!original.trim() || matchers.length === 0) return [];
  const normalized = normalizeEntityText(original);
  const matchedIds: string[] = [];

  for (const matcher of matchers) {
    for (const p of matcher.patterns) {
      if (p.requireCaseSensitive) {
        if (p.regex.test(original)) {
          matchedIds.push(matcher.entityId);
          break;
        }
      } else {
        if (p.regex.test(normalized)) {
          matchedIds.push(matcher.entityId);
          break;
        }
      }
    }
  }

  return matchedIds;
}

export function matchEntitiesInText(rawText: string, catalog: EntityCatalogEntry[]): string[] {
  return matchCompiledEntities(rawText, compileEntityMatchers(catalog));
}

export type SqlQueryExecutor = (sql: string, params?: any[]) => Promise<{ rows: any[] }>;

export async function loadActiveEntityCatalog(
  queryFn: SqlQueryExecutor
): Promise<EntityCatalogEntry[]> {
  let entitiesRows: any[] = [];
  try {
    const res = await queryFn(`SELECT id, name, slug, type FROM public.entities ORDER BY name ASC`);
    entitiesRows = res.rows || [];
  } catch {
    return [];
  }

  const aliasesByEntity = new Map<string, string[]>();
  try {
    const aliasRes = await queryFn(`SELECT entity_id, alias FROM public.entity_aliases`);
    for (const row of aliasRes.rows || []) {
      const eid = String(row.entity_id || '').trim();
      const alias = String(row.alias || '').trim();
      if (!eid || !alias) continue;
      const list = aliasesByEntity.get(eid) || [];
      list.push(alias);
      aliasesByEntity.set(eid, list);
    }
  } catch {
    // Tabela entity_aliases pode ainda não existir antes da migração V2.4.1
  }

  return entitiesRows
    .filter((r) => r?.id && r?.name)
    .map((r) => {
      const id = String(r.id);
      return {
        id,
        name: String(r.name),
        slug: r.slug ? String(r.slug) : null,
        type: r.type ? String(r.type) : null,
        aliases: aliasesByEntity.get(id) || [],
      };
    });
}

export async function linkEventEntities(
  queryFn: SqlQueryExecutor,
  eventId: string,
  entityIds: string[]
): Promise<number> {
  if (!eventId || entityIds.length === 0) return 0;
  let inserted = 0;
  for (const entityId of Array.from(new Set(entityIds))) {
    const res = await queryFn(
      `INSERT INTO public.event_entities (event_id, entity_id)
       VALUES ($1, $2)
       ON CONFLICT (event_id, entity_id) DO NOTHING
       RETURNING entity_id`,
      [eventId, entityId]
    );
    if (res.rows && res.rows.length > 0) {
      inserted++;
    }
  }
  return inserted;
}

export interface BackfillMatchPreview {
  eventId: string;
  eventTitle: string;
  entityIds: string[];
}

export async function backfillEventEntities(options: {
  queryFn: SqlQueryExecutor;
  batchSize?: number;
  limit?: number;
  dryRun?: boolean;
  onlyMissing?: boolean;
}): Promise<{
  scanned: number;
  eventsWithMatches: number;
  linksInserted: number;
  linksPlanned: number;
  dryRun: boolean;
  matchesPreview: BackfillMatchPreview[];
}> {
  const dryRun = options.dryRun !== false;
  const batchSize = Math.max(1, Math.min(200, Number(options.batchSize ?? 50)));
  const maxEvents = Math.max(1, Math.min(5000, Number(options.limit ?? 500)));
  const onlyMissing = options.onlyMissing !== false;

  const catalog = await loadActiveEntityCatalog(options.queryFn);
  const matchers = compileEntityMatchers(catalog);

  let scanned = 0;
  let eventsWithMatches = 0;
  let linksInserted = 0;
  let linksPlanned = 0;
  let offset = 0;
  let unmatchedSkipped = 0;
  const matchesPreview: BackfillMatchPreview[] = [];

  if (matchers.length === 0) {
    return {
      scanned: 0,
      eventsWithMatches: 0,
      linksInserted: 0,
      linksPlanned: 0,
      dryRun,
      matchesPreview,
    };
  }

  while (scanned < maxEvents) {
    const fetchLimit = Math.min(batchSize, maxEvents - scanned);
    const whereClause = onlyMissing
      ? `WHERE NOT EXISTS (SELECT 1 FROM public.event_entities ee WHERE ee.event_id::text = e.id::text)`
      : '';

    const queryOffset = onlyMissing && !dryRun ? unmatchedSkipped : offset;
    const eventsRes = await options.queryFn(
      `SELECT e.id, e.title, e.summary, e.why_it_matters
         FROM public.events e
         ${whereClause}
        ORDER BY e.published_at DESC NULLS LAST, e.id ASC
        LIMIT $1 OFFSET $2`,
      [fetchLimit, queryOffset]
    );

    const rows = eventsRes.rows || [];
    if (rows.length === 0) break;

    const batchIds = rows.map((r: any) => String(r.id));
    const articleTextsByEvent = new Map<string, string[]>();
    try {
      const artRes = await options.queryFn(
        `SELECT ea.event_id::text AS event_id, a.title, a.description
           FROM public.event_articles ea
           JOIN public.articles a ON a.id = ea.article_id
          WHERE ea.event_id::text = ANY($1::text[])`,
        [batchIds]
      );
      for (const ar of artRes.rows || []) {
        const list = articleTextsByEvent.get(ar.event_id) || [];
        if (ar.title) list.push(String(ar.title));
        if (ar.description) list.push(String(ar.description));
        articleTextsByEvent.set(ar.event_id, list);
      }
    } catch {
      // Ambientes sem event_articles/articles seguem apenas com campos do acontecimento
    }

    for (const ev of rows) {
      scanned++;
      const eventId = String(ev.id);
      const extraArticles = articleTextsByEvent.get(eventId) || [];
      const text = [ev.title, ev.summary, ev.why_it_matters, ...extraArticles]
        .filter(Boolean)
        .join(' • ');
      const matched = matchCompiledEntities(text, matchers);
      if (matched.length > 0) {
        eventsWithMatches++;
        linksPlanned += matched.length;
        if (matchesPreview.length < 25) {
          matchesPreview.push({
            eventId,
            eventTitle: String(ev.title || ''),
            entityIds: matched,
          });
        }
        if (!dryRun) {
          const added = await linkEventEntities(options.queryFn, eventId, matched);
          linksInserted += added;
          if (added === 0 && onlyMissing) unmatchedSkipped++;
        }
      } else if (!dryRun && onlyMissing) {
        unmatchedSkipped++;
      }
    }

    offset += rows.length;
    if (rows.length < fetchLimit) break;
  }

  return { scanned, eventsWithMatches, linksInserted, linksPlanned, dryRun, matchesPreview };
}

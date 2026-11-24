-- Rollback seguro da migração 20261123000003_perf_cursor_and_join_indexes.sql
DROP INDEX IF EXISTS public.idx_events_published_id_desc;
DROP INDEX IF EXISTS public.idx_event_topics_event_topic;
DROP INDEX IF EXISTS public.idx_articles_id_with_image;

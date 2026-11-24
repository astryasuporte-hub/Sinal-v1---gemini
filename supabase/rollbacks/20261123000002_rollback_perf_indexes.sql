-- ==============================================================================
-- FATOSBR — ROLLBACK DOS ÍNDICES DE PERFORMANCE (HOT PATHS)
-- ==============================================================================

DROP INDEX IF EXISTS public.idx_events_published_at_desc;
DROP INDEX IF EXISTS public.idx_events_relevance_published_desc;
DROP INDEX IF EXISTS public.idx_event_articles_event_primary;
DROP INDEX IF EXISTS public.idx_event_articles_event_id;
DROP INDEX IF EXISTS public.idx_event_topics_event_id;
DROP INDEX IF EXISTS public.idx_user_saved_events_user_event;
DROP INDEX IF EXISTS public.idx_user_entity_follows_entity_user;
DROP INDEX IF EXISTS public.idx_user_topic_follows_topic_user;
DROP INDEX IF EXISTS public.idx_user_source_follows_source_user;
DROP INDEX IF EXISTS public.idx_briefings_user_scheduled_desc;
DROP INDEX IF EXISTS public.idx_notifications_user_unread_created_desc;

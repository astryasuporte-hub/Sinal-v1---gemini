-- ============================================================================
-- ROLLBACK SEGURO: FATOSBR PAYMENTS V2 (20261124000001)
-- Remove apenas os objetos aditivos da V2 sem afetar public.subscriptions,
-- billing_attempts V1.3, billing_payments ou billing_events.
-- ============================================================================

DROP TABLE IF EXISTS internal.billing_fiscal_documents;
DROP TABLE IF EXISTS internal.billing_dunning_logs;
DROP TABLE IF EXISTS internal.billing_refunds;
DROP TABLE IF EXISTS internal.billing_pix_charges;

DO $$
BEGIN
  IF to_regclass('internal.billing_attempts') IS NOT NULL THEN
    ALTER TABLE internal.billing_attempts
      DROP CONSTRAINT IF EXISTS billing_attempts_recurrence_mode_check,
      DROP CONSTRAINT IF EXISTS billing_attempts_allowed_methods_v2_check;
  END IF;
END $$;

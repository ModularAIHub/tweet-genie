-- Fix: lock search_path for trigger function to satisfy DB security linting
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'update_updated_at_column'
      AND n.nspname = 'public'
  ) THEN
    ALTER FUNCTION public.update_updated_at_column()
    SET search_path = pg_catalog;
  END IF;
END $$;

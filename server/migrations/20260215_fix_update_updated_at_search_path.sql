-- Fix: lock search_path for trigger function to satisfy DB security linting
ALTER FUNCTION IF EXISTS public.update_updated_at_column()
SET search_path = pg_catalog;


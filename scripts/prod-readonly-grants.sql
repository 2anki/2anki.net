-- Grants the read-only role readonly_checks SELECT on every table in schema
-- public, leaving out the columns that hold credentials or payment provider
-- ids. Run it as the database owner after a migration that adds a table: a new
-- table is not readable by the role until this runs again. Idempotent: a table
-- that gained a hidden column loses its whole-table grant. Views and
-- materialized views get nothing from this script, because a view can expose a
-- hidden column under another name; it prints a NOTICE for each one, and a view
-- is granted by hand after reading its definition. It does not create the role
-- and holds no secret. It is never run through scripts/prod-sql.sh, whose
-- pre-flight refuses it.
DO $grants$
DECLARE
  hidden_columns text[] := ARRAY[
    'password', 'reset_token', 'token', 'refresh_token', 'anki_connect_api_key',
    'token_hash', 'key_hash', 'code_hash', 'code_challenge', 'stripe_customer_id',
    'stripe_session_id', 'checkout_session_id', 'session_id',
    'day_pass_payment_intent_id', 'stripe_payment_intent_id', 'stripe_subscription_id',
    'payment_intent_id'
  ];
  relation record;
  visible_columns text;
  present_hidden_columns text;
BEGIN
  FOR relation IN
    SELECT c.oid, c.relname, c.relkind
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
    ORDER BY c.relname
  LOOP
    IF relation.relkind IN ('v', 'm') THEN
      RAISE NOTICE 'skipped view public.%: grant it by hand after reading its definition', relation.relname;
      CONTINUE;
    END IF;

    SELECT pg_catalog.string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO present_hidden_columns
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = relation.oid AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname = ANY (hidden_columns);

    IF present_hidden_columns IS NULL THEN
      EXECUTE pg_catalog.format('GRANT SELECT ON public.%I TO readonly_checks', relation.relname);
    ELSE
      SELECT pg_catalog.string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum)
      INTO visible_columns
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = relation.oid AND a.attnum > 0 AND NOT a.attisdropped
        AND NOT (a.attname = ANY (hidden_columns));

      EXECUTE pg_catalog.format('REVOKE SELECT ON public.%I FROM readonly_checks', relation.relname);
      EXECUTE pg_catalog.format('REVOKE SELECT (%s) ON public.%I FROM readonly_checks', present_hidden_columns, relation.relname);
      IF visible_columns IS NOT NULL THEN
        EXECUTE pg_catalog.format('GRANT SELECT (%s) ON public.%I TO readonly_checks', visible_columns, relation.relname);
      END IF;
    END IF;
  END LOOP;
END
$grants$;

-- @bereich: CRM – E-Mail-Prüfung der Kontakte (KAN-424)
-- @ziel: Das Kennzeichen email_pruefung kennt nur die vier Werte, der Hinweis ist begrenzt. Ändert sich die Adresse,
-- @ziel: fallen Kennzeichen, Prüfzeitpunkt und Hinweis weg; eine andere Änderung lässt sie stehen. Ein Mitarbeiter mit
-- @ziel: CRM bestätigt eine Adresse, Leser und fremde Betriebe nicht.
-- @mutation ohne_zuruecksetzen: Trigger b_email_pruefung_zuruecksetzen entfernt | rot: adresse_geaendert_setzt_zurueck
-- @mutation ohne_check: CHECK auf email_pruefung entfernt | rot: wert_unbekannt
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 97 (Stand 12.11.2026, KAN-424). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '97_email_pruefung';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_k     uuid;
  v_con   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_k := (pg_temp.s112_zeile('kontakte', v_b, jsonb_build_object('nachname', 'S112TEST Mail', 'email', 's112test@gmial.com')) ->> 'id')::uuid;
  SELECT conname INTO v_con FROM pg_constraint
   WHERE conrelid = 'public.kontakte'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%email_pruefung%ruecklaeufer%';

  PERFORM pg_temp.s112_mutiere('ohne_zuruecksetzen',
    $m$DROP TRIGGER b_email_pruefung_zuruecksetzen ON public.kontakte$m$);
  PERFORM pg_temp.s112_mutiere('ohne_check',
    format('ALTER TABLE public.kontakte DROP CONSTRAINT %I', v_con));

  v_erg := v_erg || pg_temp.s112_erwarte('check_vorhanden', v_con IS NOT NULL, true);

  -- ── 1. Kennzeichen setzen (wie der nächtliche Lauf, als postgres) ──────────────────────────────────────────
  UPDATE public.kontakte SET email_pruefung = 'schreibweise', email_pruef_hinweis = 'S112TEST Tippfehler', email_geprueft_am = now() WHERE id = v_k;
  v_erg := v_erg || pg_temp.s112_erwarte('wert_unbekannt',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.kontakte SET email_pruefung = %L WHERE id = %L', 'irgendwas', v_k)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('hinweis_zu_lang',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.kontakte SET email_pruef_hinweis = %L WHERE id = %L', repeat('x', 201), v_k)), ':', 1), '23514');

  -- ── 2. Andere Änderung lässt das Kennzeichen stehen, geänderte Adresse setzt zurück ────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  UPDATE public.kontakte SET notizen = 'S112TEST andere Änderung' WHERE id = v_k;
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('andere_aenderung_laesst_stehen',
    (SELECT email_pruefung || '/' || (email_geprueft_am IS NOT NULL) FROM public.kontakte WHERE id = v_k), 'schreibweise/true');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_bestaetigt_nicht',
    pg_temp.s112_versuch(format('UPDATE public.kontakte SET email_pruefung = %L WHERE id = %L', 'bestaetigt', v_k)), 'k0');
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb_bestaetigt_nicht',
    pg_temp.s112_versuch(format('UPDATE public.kontakte SET email_pruefung = %L WHERE id = %L', 'bestaetigt', v_k)), 'k0');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('mitarbeiter_bestaetigt',
    pg_temp.s112_fehlertext(format('UPDATE public.kontakte SET email_pruefung = %L, email_pruef_hinweis = NULL WHERE id = %L AND email_pruefung IN (%L, %L)', 'bestaetigt', v_k, 'schreibweise', 'domain')), 'ok');
  UPDATE public.kontakte SET email = 's112test@gmail.com' WHERE id = v_k;
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('adresse_geaendert_setzt_zurueck',
    (SELECT (email_pruefung IS NULL AND email_geprueft_am IS NULL AND email_pruef_hinweis IS NULL)::text FROM public.kontakte WHERE id = v_k), 'true');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 8);
END $test$;

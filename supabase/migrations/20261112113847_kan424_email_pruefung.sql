-- KAN-424 (12.11.2026): E-Mail-Adressen der Kontakte prüfen und kennzeichnen.
--
-- Der tägliche Lauf prüft Schreibweise und Domain der Kontakt-Adressen und wertet Rückläufer aus dem Brevo-Konto des
-- Betriebs aus. Auffällige Adressen bekommen ein Kennzeichen – nichts wird automatisch geändert oder gelöscht.
--   email_pruefung:  NULL = unauffällig bzw. noch nicht geprüft · schreibweise · domain · ruecklaeufer ·
--                    bestaetigt (vom Betrieb als richtig bestätigt – wird nicht mehr geprüft)
--   email_geprueft_am: letzter Prüfzeitpunkt (Wiederholung frühestens nach 90 Tagen)
--   email_pruef_hinweis: Klartext für die Anzeige
-- Ändert sich die Adresse, fallen alle drei Angaben weg und sie wird neu geprüft.

ALTER TABLE public.kontakte
  ADD COLUMN email_pruefung      text CHECK (email_pruefung IS NULL OR email_pruefung IN ('schreibweise', 'domain', 'ruecklaeufer', 'bestaetigt')),
  ADD COLUMN email_geprueft_am   timestamptz,
  ADD COLUMN email_pruef_hinweis text CHECK (email_pruef_hinweis IS NULL OR length(email_pruef_hinweis) <= 200);

COMMENT ON COLUMN public.kontakte.email_pruefung IS
  'Ergebnis der E-Mail-Prüfung (KAN-424): NULL unauffällig/ungeprüft, schreibweise, domain, ruecklaeufer, bestaetigt. Wird bei geänderter Adresse zurückgesetzt.';

CREATE FUNCTION public.s112_kontakt_email_pruefung_zuruecksetzen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    NEW.email_pruefung := NULL;
    NEW.email_geprueft_am := NULL;
    NEW.email_pruef_hinweis := NULL;
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.s112_kontakt_email_pruefung_zuruecksetzen() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER b_email_pruefung_zuruecksetzen
  BEFORE UPDATE OF email ON public.kontakte
  FOR EACH ROW EXECUTE FUNCTION public.s112_kontakt_email_pruefung_zuruecksetzen();

-- nächtlicher Lauf: je Betrieb die am längsten nicht geprüften Adressen zuerst
CREATE INDEX kontakte_email_pruefung_lauf_idx ON public.kontakte (tenant_id, email_geprueft_am NULLS FIRST)
  WHERE email IS NOT NULL AND aktiv;
-- Filter „E-Mail prüfen“ in der Kontaktliste
CREATE INDEX kontakte_email_pruefung_idx ON public.kontakte (tenant_id, email_pruefung)
  WHERE email_pruefung IS NOT NULL;

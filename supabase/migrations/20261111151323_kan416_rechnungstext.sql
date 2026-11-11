-- KAN-416 Punkt 1 (11.11.2026): „Text auf Rechnung“ am Lieferschein – nachträglich ergänzbar, bis die Rechnung erstellt ist.
-- Entscheidung Jörgen (11.11.2026, Kommentar im Ticket): zwei Felder am Lieferschein – „Interne Notiz“ (verkaufsposten.notizen,
-- nie gedruckt, jederzeit änderbar) und „Text auf Rechnung“ (neu, wird auf der Rechnung gedruckt, bei Sammelrechnungen je
-- Lieferschein). Nach dem Erstellen der Rechnung ist der gedruckte Text unveränderlich (Rechnung = Beleg).
--
--  1. verkaufsposten.rechnungstext (höchstens 1.000 Zeichen).
--  2. Trigger a_rechnungstext_schutz: Solange der Lieferschein an einer Rechnung hängt (rechnung_id gesetzt), lässt sich
--     rechnungstext nicht ändern (42501, HINT rechnungstext). Wird die Rechnung storniert und der Lieferschein wieder frei,
--     ist der Text wieder änderbar. Wartung (s112.loeschen_erlaubt = Betrieb bzw. Demo-Reset) passiert die Sperre.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion. Erst danach die App (PR KAN-416) mergen.

ALTER TABLE public.verkaufsposten ADD COLUMN rechnungstext text
  CONSTRAINT verkaufsposten_rechnungstext_chk CHECK (rechnungstext IS NULL OR char_length(rechnungstext) <= 1000);
COMMENT ON COLUMN public.verkaufsposten.rechnungstext IS
  'KAN-416: Text, der auf der Rechnung gedruckt wird (je Lieferschein); änderbar, bis der Lieferschein an einer Rechnung hängt. Interne Notizen stehen in notizen.';

-- SECURITY DEFINER wie die übrigen Schutz-Trigger: s112_wartung_frei ist für API-Rollen nicht ausführbar
CREATE FUNCTION public.s112_rechnungstext_schutz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
BEGIN
  IF NEW.rechnungstext IS NOT DISTINCT FROM OLD.rechnungstext THEN
    RETURN NEW;
  END IF;
  IF public.s112_wartung_frei(OLD.tenant_id) THEN
    RETURN NEW;
  END IF;
  -- OLD und NEW: weder der Text einer berechneten Lieferung noch ein Text „im selben Zug“ mit dem Zuordnen zur Rechnung
  IF OLD.rechnung_id IS NOT NULL THEN
    RAISE EXCEPTION 'Der Text auf der Rechnung lässt sich nicht mehr ändern: Die Rechnung ist bereits erstellt. Berichtigung über einen Storno der Rechnung.'
      USING ERRCODE = '42501', HINT = 'rechnungstext';
  END IF;
  RETURN NEW;
END
$f$;
REVOKE EXECUTE ON FUNCTION public.s112_rechnungstext_schutz() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a_rechnungstext_schutz
  BEFORE UPDATE OF rechnungstext ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_rechnungstext_schutz();

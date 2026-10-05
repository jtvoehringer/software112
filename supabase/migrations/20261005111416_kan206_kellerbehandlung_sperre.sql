-- KAN-206 (05.10.2026): Kellerbehandlungen – Kellerbuch-Periodensperre und Sperre bei Chargen mit Prüfnummer (Matrix KAN-85).
--  1. a_periodensperre auf keller_behandlungen: im abgeschlossenen Kellerbuch-Zeitraum kein Anlegen, Ändern (Datum, Menge,
--     Einheit, Charge, Gebinde, Typ) oder Löschen – wie bei allen anderen Kellerbuch-Bewegungen (kan192a). Storno bleibt.
--  2. a_freeze auf keller_behandlungen: lag die Charge am Tag der Behandlung unter einer gültigen Prüfnummer
--     (pruefnummer_chargen), sind nach dem Speichern nur Notizen und Storno änderbar; Korrektur durch die Betriebsleitung
--     über s112_freeze_korrektur (Entscheidung KAN-85). App: behandlungPnGesperrt (src/lib/kellerbuch/behandlungRegeln.ts).
--  3. Demo-Reset: die Behandlungstypen des Musterhofs sind eingestuft (Pflege) statt „nicht eingestuft“; Bestand ebenso.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Periodensperre
CREATE TRIGGER a_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public.keller_behandlungen FOR EACH ROW
  EXECUTE FUNCTION public.s112_kellerbuch_periodensperre('datum', 'datum,menge,einheit,weinausbau_id,behaelter_id,typ_id');

-- 2. Sperre bei Charge mit Prüfnummer
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.keller_behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Behandlung einer Charge mit Prüfnummer',
    $$o.storniert_am IS NULL AND o.weinausbau_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.pruefnummer_chargen pc
         WHERE pc.weinausbau_id = o.weinausbau_id AND pc.gueltig_ab <= o.datum::date
           AND (pc.gueltig_bis IS NULL OR pc.gueltig_bis >= o.datum::date))$$,
    'notizen,updated_at,storniert_am,storniert_von,storniert_von_name,storno_grund',
    'datum');

-- 3. Demo-Reset: Typen eingestuft
DO $$
DECLARE
  c_alt constant text := $a$(demo_musterhof_id(15,5), c_t, 'Gärtemperatur',       '°C', 50);$a$;
  v_def text := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
BEGIN
  IF (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-206: Stelle „%“ im Demo-Reset nicht genau einmal gefunden', c_alt;
  END IF;
  EXECUTE replace(v_def, c_alt, c_alt || E'\n  update keller_behandlungstypen set pn_wirkung = ''pflege'' where tenant_id = c_t;   -- KAN-206: eingestuft');
END $$;

UPDATE public.keller_behandlungstypen SET pn_wirkung = 'pflege'
 WHERE tenant_id = '33333333-3333-4333-8333-333333333333' AND pn_wirkung = 'unklar';

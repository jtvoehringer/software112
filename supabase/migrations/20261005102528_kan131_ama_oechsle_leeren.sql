-- KAN-131 (05.10.2026): ama_meldepositionen.oechsle leeren (Entscheidung Jörgen, offene Frage 3).
-- Die Spalte war nur im Demo-Betrieb Musterhof befüllt – vom Demo-Reset mit dem falschen Faktor 4,8 aus dem
-- Ø °KMW – und für die KI-Abfrage sichtbar. Das Mostgewicht steht in den Mostgewichtsspalten (ernte_parzellen,
-- pressung_weingaerten, pressungen, weinausbau, zukauf_posten, traubenverkauf); die KI liest nur dort.
--  1. Demo-Reset: die Positionen bekommen kein °Oe mehr (Stelle per Ersatz, mit Prüfung, dass sie genau einmal vorkommt).
--  2. Bestand leeren (nur Musterhof; der Schutz a_ama_position_schutz lässt dort Wartung zu).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

DO $$
DECLARE
  c_alt constant text := 'round(avg(ep.klosterneuburger) * 4.8)';
  v_def text := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
BEGIN
  IF (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-131: Stelle „%“ im Demo-Reset nicht genau einmal gefunden', c_alt;
  END IF;
  EXECUTE replace(v_def, c_alt, 'NULL::numeric');
END $$;

UPDATE public.ama_meldepositionen SET oechsle = NULL WHERE oechsle IS NOT NULL;

COMMENT ON COLUMN public.ama_meldepositionen.oechsle IS
  'KAN-131: ungenutzt (leer) – Mostgewicht steht in den Mostgewichtsspalten der Lese, Pressung und Charge';

-- KAN-44 Teil 2 (08.10.2026): Füllstand je Gebinde = Bestand der Chargen im Gebinde
--
-- v_behaelter_fuellstand rechnete den Füllstand aus den Bewegungen nach (Anfangsbestand + Zukauf + Pressung + Umzug
-- + Verschnitt − Füllung − Fassverkauf). Dabei fehlten Bewegungsarten, die es inzwischen gibt (Bestandskorrektur,
-- Zugangskorrektur, Verarbeitung, Produktion, Lohnversektung, Abstufung …), und Umzüge wurden über alle Gebinde
-- einer Charge verteilt. Ergebnis (Produktion, 08.10.2026): Musterhof Stahltank 11 400 statt 280 L, Stahltank 08
-- 1.450 statt 1.485 L; Sandbox mit negativen Füllständen.
--
-- Neu: liter_aktuell = Summe weinausbau.menge_liter der nicht stornierten Chargen im Gebinde – derselbe Bestand,
-- gegen den das Bewegungsjournal (kellerbuch_buchungen) abgeglichen wird (journal_konsistenz, täglicher
-- journal_abgleichen). Je Gebinde und Betrieb der Charge eine Zeile (Kellergemeinschaft: fremde Chargen im eigenen
-- Gebinde stehen beim Partnerbetrieb), dazu jedes Gebinde mit 0 L für den eigenen Betrieb. Spalten, Typen,
-- security_invoker und Rechte bleiben unverändert.

CREATE OR REPLACE VIEW public.v_behaelter_fuellstand WITH (security_invoker = true) AS
WITH inhalt AS (
  SELECT w.behaelter_id, w.tenant_id, sum(w.menge_liter) AS liter
    FROM public.weinausbau w
   WHERE w.behaelter_id IS NOT NULL
     AND w.storniert_am IS NULL
     AND w.menge_liter > 0
   GROUP BY w.behaelter_id, w.tenant_id
), paare AS (
  SELECT i.behaelter_id, i.tenant_id FROM inhalt i
  UNION
  SELECT b.id, b.tenant_id FROM public.behaelter b
)
SELECT p.behaelter_id,
       p.tenant_id,
       round(COALESCE(i.liter, 0::numeric), 2) AS liter_aktuell
  FROM paare p
  LEFT JOIN inhalt i ON i.behaelter_id = p.behaelter_id AND i.tenant_id = p.tenant_id;

COMMENT ON VIEW public.v_behaelter_fuellstand IS
  'Füllstand je Gebinde und Betrieb = Bestand der nicht stornierten Chargen im Gebinde (KAN-44 Teil 2); entspricht dem Saldo des Bewegungsjournals.';

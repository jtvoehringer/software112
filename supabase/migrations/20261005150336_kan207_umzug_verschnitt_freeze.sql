-- KAN-207 (05.10.2026): Umzug und Verschnitt sind nach dem Speichern fest (Matrix KAN-85: „sofort, Korrektur per Storno“).
--  a_freeze auf keller_umzuege und verschneidungen: nicht stornierte Zeilen nur noch in Notizen und Storno änderbar.
--  a_freeze auf verschneidung_quellen (ohne eigene Storno-Spalten): fest, solange der Verschnitt nicht storniert ist –
--  nur anteil_pct (rechnet s112_verschnitt_buchen gleich nach dem Anlegen) bleibt. Ohne tenant_id prüft die Bedingung die
--  Wartung (Mandant löschen, Demo-Reset) über den Verschnitt selbst.
-- Korrektur: Stornieren und neu buchen (Umzug „Bearbeiten“ macht genau das) bzw. Betriebsleitung per s112_freeze_korrektur.
-- App: updateUmzug ändert kein Datum mehr, umziehen() verlangt ein Datum.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.keller_umzuege
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Umzug gebucht',
    $$o.storniert_am IS NULL$$,
    'notizen,storniert_am,storniert_von,storniert_von_name,storno_grund',
    'datum');

CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.verschneidungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Verschnitt gebucht',
    $$o.storniert_am IS NULL$$,
    'notizen,storniert_am,storniert_von,storniert_von_name,storno_grund',
    'datum');

CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.verschneidung_quellen
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Verschnitt gebucht',
    $$EXISTS (SELECT 1 FROM public.verschneidungen v WHERE v.id = o.verschneidung_id AND v.storniert_am IS NULL
              AND NOT coalesce(public.s112_wartung_frei(v.tenant_id), false))$$,
    'anteil_pct',
    '');

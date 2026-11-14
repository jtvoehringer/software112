-- KAN-459 (14.11.2026), Teil 2: Leseprüfung in schreibenden SECURITY-DEFINER-Funktionen.
--
-- Seit kan459a gilt die Sperr-Policy „lesebereich“ für alle Befehle. SECURITY-DEFINER-Funktionen laufen an den Policies
-- vorbei; vier davon erreicht ein Mitglied mit Profil über Rolle bzw. Schreibmodul, obwohl es den Bereich nicht liest
-- (Inventar und Einteilung im Ticket, bestätigt von Jörgen 14.11.2026):
--   • s112_privat_bloecke             – jedes Mitglied; liefert Zeitblöcke aus den CRM-Aktivitäten        → crm
--   • setze_kontobewegung_abgeglichen – Modul Warenwirtschaft/E&A; der Bankabgleich gehört zur E&A        → ea
--   • s112_fuellung_nachtragen        – Modul Warenwirtschaft; ordnet Charge und Prüfnummer zu            → keller
--   • s112_storniert_loeschen         – Modul je Tabelle; löscht in 17 Tabellen                           → Bereich der Tabelle
-- Bewusst ohne Leseprüfung bleiben s112_zukauf_buchen, s112_zahlung_stornieren, s112_kontakt_personendaten_loeschen und
-- get_next_transaktionsnr (Folgebuchungen bzw. Nummernkreis, liefern keine Daten des fremden Bereichs).
-- s112_kellerbehandlung_sammel ist SECURITY INVOKER – dort greifen seit kan459a die Policies.
-- Für Mitglieder ohne Profil ändert sich nichts (s112_pruefe_lesen lässt sie durch).

DO $$
DECLARE
  c_ptz constant text := '(PERFORM public\.pruefe_tenant_zugriff\(p_tenant_id[^;]*;)';
  r     record;
  v_oid regprocedure;
  v_alt text;
  v_neu text;
BEGIN
  -- 1. Fester Bereich: Prüfung direkt nach der Zugriffsprüfung
  FOR r IN SELECT * FROM (VALUES
    ('public.s112_privat_bloecke(uuid)', 'crm'),
    ('public.setze_kontobewegung_abgeglichen(uuid, text, uuid, boolean)', 'ea'),
    ('public.s112_fuellung_nachtragen(uuid, uuid, uuid, uuid)', 'keller')
  ) AS t(funktion, bereich) LOOP
    v_oid := r.funktion::regprocedure;
    v_alt := pg_get_functiondef(v_oid);
    IF v_alt ~ 's112_(pruefe|darf)_lesen' THEN RAISE EXCEPTION 'KAN-459: % prüft das Leserecht schon', r.funktion; END IF;
    IF (SELECT count(*) FROM regexp_matches(v_alt, c_ptz, 'g')) <> 1 THEN RAISE EXCEPTION 'KAN-459: % – Anker pruefe_tenant_zugriff nicht genau einmal', r.funktion; END IF;
    v_neu := regexp_replace(v_alt, c_ptz, format(E'\\1\n  PERFORM public.s112_pruefe_lesen(p_tenant_id, %L);   -- KAN-459: Lesebereich je Profil', r.bereich));
    IF (length(v_neu) - length(replace(v_neu, 's112_pruefe_lesen', ''))) / length('s112_pruefe_lesen') <> 1 THEN
      RAISE EXCEPTION 'KAN-459: % – Prüfung nicht genau einmal eingefügt', r.funktion;
    END IF;
    EXECUTE v_neu;
  END LOOP;

  -- 2. s112_storniert_loeschen: Bereich der übergebenen Tabelle (wie scripts/lesebereiche.json), nach der Modulprüfung –
  --    dort ist p_tabelle schon gegen die Liste geprüft. Unbekannt → verwaltung (für jedes Profil gesperrt).
  v_alt := replace(pg_get_functiondef('public.s112_storniert_loeschen(uuid, text, uuid, text)'::regprocedure), E'\r\n', E'\n');
  v_neu := replace(v_alt,
    E'    RAISE EXCEPTION \'Für das endgültige Löschen fehlt das Schreibrecht (Modul %).\', array_to_string(v_module, \' bzw. \') USING ERRCODE = \'42501\';\n  END IF;',
    E'    RAISE EXCEPTION \'Für das endgültige Löschen fehlt das Schreibrecht (Modul %).\', array_to_string(v_module, \' bzw. \') USING ERRCODE = \'42501\';\n  END IF;\n'
    || E'  -- KAN-459: Lesebereich je Profil – wer die Tabelle nicht liest, löscht dort auch nicht\n'
    || E'  PERFORM public.s112_pruefe_lesen(p_tenant_id, CASE\n'
    || E'    WHEN p_tabelle IN (\'verschneidungen\', \'keller_umzuege\', \'keller_behandlungen\', \'dac_antrag\', \'weinanalysen\', \'pruefnummernantraege\') THEN \'keller\'\n'
    || E'    WHEN p_tabelle IN (\'fuellungen\', \'zukauf_posten\', \'transportbescheinigungen\') THEN \'lager\'\n'
    || E'    WHEN p_tabelle IN (\'pressungen\', \'ernte_parzellen\', \'traubenverkauf\') THEN \'lese\'\n'
    || E'    WHEN p_tabelle = \'exportauftraege\' THEN \'verkauf\'\n'
    || E'    WHEN p_tabelle = \'behandlungen\' THEN \'massnahmen\'\n'
    || E'    WHEN p_tabelle IN (\'betriebsmittel_lager_bewegungen\', \'psm_lager_bewegungen\', \'duengemittel_lager_bewegungen\') THEN \'betriebsmittel\'\n'
    || E'    ELSE \'verwaltung\' END);');
  IF v_neu = v_alt OR v_alt ~ 's112_pruefe_lesen' THEN RAISE EXCEPTION 'KAN-459: s112_storniert_loeschen – Anker fehlt'; END IF;
  IF (length(v_neu) - length(replace(v_neu, 's112_pruefe_lesen', ''))) / length('s112_pruefe_lesen') <> 1 THEN
    RAISE EXCEPTION 'KAN-459: s112_storniert_loeschen – Prüfung nicht genau einmal eingefügt';
  END IF;
  EXECUTE v_neu;
END $$;

-- KAN-300 (10.11.2026): Nachweis der Zustimmung zu den Vertragsunterlagen bei der Registrierung.
-- Die Registrierung (src/app/signup/actions.ts, Service-Role) speichert beim neuen Betrieb, welche Fassung der
-- AGB/AVV/Leistungsbeschreibung bestätigt wurde, wann und von wem (die Bestätigung bei der Buchung gilt laut AVV als
-- Unterzeichnung). Bestehende Betriebe (Einzelvereinbarungen) bleiben leer.
--
-- Benutzer können die Spalten nicht schreiben: a_schutz_plattformfelder lässt für authenticated/anon auf tenants nur
-- bio_status zu. Lesen wie die übrigen Spalten von tenants (Tabellenrecht). Kein FK auf auth.users (Konto kann später
-- gelöscht werden, der Nachweis bleibt) – daher auch kein Index und kein Fremdverweis-Trigger nötig.
--
-- Rollback: ALTER TABLE public.tenants DROP CONSTRAINT tenants_vertrag_nachweis_vollstaendig,
--           DROP COLUMN vertrag_fassung, DROP COLUMN vertrag_bestaetigt_am, DROP COLUMN vertrag_bestaetigt_von;

ALTER TABLE public.tenants
  ADD COLUMN vertrag_fassung        text,
  ADD COLUMN vertrag_bestaetigt_am  timestamptz,
  ADD COLUMN vertrag_bestaetigt_von uuid;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_vertrag_nachweis_vollstaendig CHECK (
    (vertrag_fassung IS NULL AND vertrag_bestaetigt_am IS NULL AND vertrag_bestaetigt_von IS NULL)
    OR (vertrag_fassung IS NOT NULL AND vertrag_bestaetigt_am IS NOT NULL AND vertrag_bestaetigt_von IS NOT NULL)
  );

COMMENT ON COLUMN public.tenants.vertrag_fassung        IS 'KAN-300: bei der Registrierung bestätigte Fassung der Vertragsunterlagen (VERTRAG_KENNUNG, z. B. „v3 2026-11-10“)';
COMMENT ON COLUMN public.tenants.vertrag_bestaetigt_am  IS 'KAN-300: Zeitpunkt der Bestätigung';
COMMENT ON COLUMN public.tenants.vertrag_bestaetigt_von IS 'KAN-300: auth.users.id der bestätigenden Person (ohne FK, Nachweis bleibt bei Kontolöschung)';

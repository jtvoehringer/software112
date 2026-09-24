-- Nachtrag zu Legacy-Migrationen 025, 050, 052 (Abgleich 24.09.2026):
-- Objekte, die im Live-Schema fehlten bzw. in der Legacy-Datei nie laufen konnten.
-- Idempotent geschrieben, damit auch ein Neuaufbau (Legacy + migrations/) denselben Stand ergibt.

-- ── 1. verkaufsposten: aktualisiert_am automatisch pflegen (025) ─────────────
-- 025 hängte update_updated_at() an – die setzt NEW.updated_at, verkaufsposten hat
-- aber aktualisiert_am (gleicher Fehler wie 026/057/066). Deshalb update_aktualisiert_am().
-- verkauf_positionen hat keine Änderungsspalte → kein Trigger nötig.
DROP TRIGGER IF EXISTS verkaufsposten_updated_at ON public.verkaufsposten;
CREATE TRIGGER verkaufsposten_updated_at
  BEFORE UPDATE ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.update_aktualisiert_am();

-- updated_at existiert live bereits (außerhalb der Historie angelegt, nur von
-- demo_musterhof_verkauf beschrieben) – hier nur nachgetragen, live ein No-op.
ALTER TABLE public.verkaufsposten
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ── 2. aktivitaeten.erstellt_von: FK, Index, Kommentare (050) ────────────────
-- Verweise auf gelöschte Benutzer auf NULL setzen – genau das, was
-- ON DELETE SET NULL beim Löschen getan hätte (Stand 24.09.2026: 16 Zeilen).
UPDATE public.aktivitaeten a
   SET erstellt_von = NULL
 WHERE a.erstellt_von IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.erstellt_von);

-- 020 legte den FK ohne ON DELETE an (blockiert das Löschen von Benutzern);
-- live fehlt er ganz. Einheitlich mit ON DELETE SET NULL wie in 050 vorgesehen.
ALTER TABLE public.aktivitaeten DROP CONSTRAINT IF EXISTS aktivitaeten_erstellt_von_fkey;
ALTER TABLE public.aktivitaeten
  ADD CONSTRAINT aktivitaeten_erstellt_von_fkey
  FOREIGN KEY (erstellt_von) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_aktivitaeten_erstellt_von ON public.aktivitaeten(erstellt_von);

COMMENT ON COLUMN public.aktivitaeten.ist_privat   IS 'Nur Ersteller sieht Details, andere sehen nur "Privat"';
COMMENT ON COLUMN public.aktivitaeten.erstellt_von IS 'User, der die Aktivität angelegt hat';
COMMENT ON COLUMN public.aktivitaeten.bis_datum    IS 'Enddatum für Mehrtagestermine (z. B. Urlaub Mo–Fr)';

-- ── 3. release_notes: Schreibrecht für System-Admins (052) ───────────────────
-- 052 referenzierte tenant_memberships.rolle (Spalte heißt role) und lief nie.
-- Ohne diese Policy scheitern Insert/Update aus /admin/release-notes still.
DROP POLICY IF EXISTS rn_admin ON public.release_notes;
CREATE POLICY rn_admin ON public.release_notes
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_memberships m
     WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role = 'system_admin'))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tenant_memberships m
     WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role = 'system_admin'));

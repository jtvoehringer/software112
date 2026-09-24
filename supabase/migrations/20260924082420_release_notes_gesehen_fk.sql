-- release_notes_gesehen.user_id hatte keinen FK (Legacy 052): Gesehen-Vermerke
-- gelöschter Benutzer blieben stehen und blähten den „× gesehen“-Zähler auf
-- /admin/release-notes auf (Stand 24.09.2026: 5 von 15 Zeilen verwaist).

-- Verwaiste Vermerke entfernen – genau das, was ON DELETE CASCADE getan hätte
DELETE FROM public.release_notes_gesehen g
 WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = g.user_id);

ALTER TABLE public.release_notes_gesehen DROP CONSTRAINT IF EXISTS release_notes_gesehen_user_id_fkey;
ALTER TABLE public.release_notes_gesehen
  ADD CONSTRAINT release_notes_gesehen_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- user_id ist über UNIQUE (user_id, release_note_id) bereits indiziert; release_note_id
-- (FK, Filter in releaseNoteErneutAnzeigen) bekommt einen eigenen Index
CREATE INDEX IF NOT EXISTS idx_release_notes_gesehen_release_note ON public.release_notes_gesehen(release_note_id);

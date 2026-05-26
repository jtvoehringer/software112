-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 015 – Behandlungen Erweiterung
-- Anteilige Mittelverteilung auf Grundstücke + Cu-Bilanz
-- Neu: art, menge_gesamt, menge_einheit, konzentration, datum_bis
--      cu_gehalt_pct in pflanzenschutzmittel
--      flaeche_ha Snapshot in behandlung_grundstuecke
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── BEHANDLUNGEN: Art & Mengendaten ─────────────────────────────────────────

alter table behandlungen
  add column if not exists art           text check (art in (
                                           'spritzung','duengung','bodenbearbeitung',
                                           'schnitt','laubarbeit','lese','sonstiges'
                                         )) default 'spritzung',
  add column if not exists menge_gesamt  numeric(10,3),     -- gesamte eingesetzte Menge
  add column if not exists menge_einheit text check (menge_einheit in ('kg','l','g','ml')),
  add column if not exists konzentration numeric(6,4),       -- z.B. 0.005 = 0.5 %
  add column if not exists datum_bis     date;               -- mehrtägige Massnahmen

comment on column behandlungen.menge_gesamt  is 'Gesamt eingesetzte Produktmenge fuer diese Behandlung';
comment on column behandlungen.art           is 'Art der Massnahme: spritzung, duengung, etc.';
comment on column behandlungen.konzentration is 'Konzentration als Dezimalzahl (0.01 = 1 %)';

-- ─── PFLANZENSCHUTZMITTEL: Cu-Gehalt ─────────────────────────────────────────

alter table pflanzenschutzmittel
  add column if not exists cu_gehalt_pct numeric(6,3) default 0;

comment on column pflanzenschutzmittel.cu_gehalt_pct is
  'Elementarer Cu-Anteil in % des Praeparats. Beispiele: Cuprozin 18.9, Cuproxat 19, Funguran 50';

-- ─── BEHANDLUNG_GRUNDSTUECKE: Flaechen-Snapshot ──────────────────────────────
-- Fläche wird beim Erfassen der Behandlung gespeichert (historische Korrektheit)

alter table behandlung_grundstuecke
  add column if not exists flaeche_ha numeric(10,4);

comment on column behandlung_grundstuecke.flaeche_ha is
  'Snapshot der Grundstueck-Flaeche zum Zeitpunkt der Behandlung (unveraenderlich)';

-- Bestehende Eintraege backfill aus grundstuecke-Tabelle
update behandlung_grundstuecke bg
set    flaeche_ha = g.flaeche_ha
from   grundstuecke g
where  bg.grundstueck_id = g.id
  and  bg.flaeche_ha is null;

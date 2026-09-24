-- 153_weinausbau_referenz_altsystem.sql
--
-- Neues Feld fuer Chargen (weinausbau), v.a. fuer Eroeffnungsbestand/
-- Anfangsbestandsbuchungen aus einem Altsystem: haelt die Referenz-/
-- Chargennummer aus dem Altsystem fest, getrennt von den freien Notizen.
-- Wird von der Eroeffnungsbestand-Erfassung (Kellerbuch > Gebinde) und der
-- neuen Anfangsbestandsbuchung im Datenimport (Gebinde) gemeinsam genutzt.

alter table public.weinausbau
  add column if not exists referenz_altsystem text;

comment on column public.weinausbau.referenz_altsystem is
  'Referenz-/Chargennummer aus dem Altsystem, z.B. bei Uebernahme eines Anfangsbestands ueber Eroeffnungsbestand/Datenimport.';

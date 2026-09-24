-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 150: Zahlungsziel wandert vom Betrieb zum Kunden
--
-- Bisher hatte jeder Betrieb EIN zentrales Zahlungsziel
-- (tenant_einstellungen.rechnung_zahlungsziel), das fuer alle Rechnungen
-- gleichermassen galt. firmen.zahlungsziel_tage existierte zwar bereits
-- (Migration 019), wurde aber nie tatsaechlich fuer die Rechnungsberechnung
-- herangezogen - nur ueber das Formular erfasst und sonst ignoriert.
--
-- Ab jetzt hat JEDER Kunde (Kontakt ODER Firma) ein eigenes, verpflichtendes
-- Zahlungsziel in Tagen. Ein Wert von 0 bedeutet "bei Erhalt" (siehe
-- src/lib/pdf/verkaufRechnungPdf.tsx).
--
-- tenant_einstellungen.rechnung_zahlungsziel wird bewusst NICHT geloescht
-- (nur nicht mehr verwendet) - unnoetiges Risiko fuer eine reine Aufraeum-
-- Aktion, die Spalte kann in einer spaeteren Migration entfernt werden,
-- falls gewuenscht.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── kontakte: neue Pflichtspalte ──────────────────────────────────────────────
-- Default 14 beim Anlegen der Spalte, damit bestehende Zeilen sofort einen
-- gueltigen Wert haben (identisch zum bisherigen tenant-weiten Default, der
-- tatsaechlich fuer die Rechnungsberechnung verwendet wurde - siehe oben).
alter table kontakte
  add column zahlungsziel_tage int not null default 14;

-- ── firmen: bestehende Spalte zur Pflichtspalte machen ────────────────────────
-- Erst bestehende NULL-Werte befuellen (Spalte war bisher optional, Default 30
-- galt nur fuer NEUE Zeilen ab Migration 019 - bestehende Zeilen koennen NULL
-- sein), dann NOT NULL setzen. Befuellung ebenfalls mit 14 statt dem alten
-- Formular-Default 30, weil 14 der Wert war, der tatsaechlich fuer die
-- Rechnungsberechnung dieser Firmen verwendet wurde (siehe Kommentar oben) -
-- der Default-Wert fuer NEU angelegte Firmen bleibt unten unveraendert bei 30.
update firmen
  set zahlungsziel_tage = 14
  where zahlungsziel_tage is null;

alter table firmen
  alter column zahlungsziel_tage set not null;

comment on column kontakte.zahlungsziel_tage is 'Zahlungsziel in Tagen fuer Rechnungen an diesen Kontakt. 0 = "bei Erhalt". Pflichtfeld seit Migration 150.';
comment on column firmen.zahlungsziel_tage is 'Zahlungsziel in Tagen fuer Rechnungen an diese Firma. 0 = "bei Erhalt". Pflichtfeld seit Migration 150 (vorher optional und ungenutzt).';

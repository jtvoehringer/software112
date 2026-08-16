-- Migration 167: Lieferanten-Verknüpfung für Belege-OCR
--
-- Kontext: "Belege (OCR)" (Migration 166) soll erkennen, wenn ein Beleg eine
-- Eingangsrechnung eines Lieferanten ist, und diese mit der passenden Firma
-- im CRM verknüpfen (bzw. bei Bedarf eine neue Firma anlegen lassen).
-- Tankrechnungen/Kassenbons ohne erkennbaren Geschäftspartner bleiben
-- weiterhin ohne Lieferanten buchbar.

-- ── 1. firmen.ist_kunde / ist_lieferant formalisieren ──────────────────────────
-- Diese beiden Spalten existieren in der Produktionsdatenbank bereits (wurden
-- händisch im Supabase-Dashboard angelegt, ohne zugehörige Migration - siehe
-- Verwendung in src/app/api/verkauf-stammdaten/route.ts und
-- weinhandel/verkauf/neu/page.tsx). Sie werden hier für alle Umgebungen
-- (Sandbox, künftige Mandanten-Setups, lokale Entwicklung) formal nachgezogen.
-- IF NOT EXISTS macht das für die Produktion zu einem No-Op.
ALTER TABLE firmen ADD COLUMN IF NOT EXISTS ist_kunde     boolean NOT NULL DEFAULT true;
ALTER TABLE firmen ADD COLUMN IF NOT EXISTS ist_lieferant boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN firmen.ist_kunde IS 'Firma ist als Kunde auswählbar (z.B. im Verkauf). Default true - bestehender Code behandelt NULL/true gleich.';
COMMENT ON COLUMN firmen.ist_lieferant IS 'Firma ist als Lieferant auswählbar (z.B. Zukauf, Belege-OCR-Lieferantenzuordnung).';

-- ── 2. ea_transaktionen.firma_id ────────────────────────────────────────────────
-- Optionale Verknüpfung einer E&A-Buchung mit einem Lieferanten (Firma).
-- Gleiches FK-Muster wie zukauf_posten.lieferant_firma_id (Migration 055).
ALTER TABLE ea_transaktionen ADD COLUMN IF NOT EXISTS firma_id uuid REFERENCES firmen(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ea_transaktionen_firma_idx ON ea_transaktionen (firma_id);

COMMENT ON COLUMN ea_transaktionen.firma_id IS 'Optionaler Lieferant/Rechnungssteller - z.B. aus Belege-OCR erkannt/zugeordnet oder manuell gesetzt. Bewusst NICHT verpflichtend (Tankrechnungen, Kassenbons, sonstige Aufwände brauchen keinen Lieferanten).';

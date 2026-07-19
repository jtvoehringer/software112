-- Zeiterfassung 18.07.2026 – software:112

INSERT INTO zeiterfassung (tenant_id, datum, phase, beschreibung, stunden, stundensatz) VALUES

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-18', 4,
   'Maßnahmenformular Phase 1+2 – kontextsensitive Felder je Maßnahmenart (Feld-Matrix: Spritzung/Düngung/Bodenbearbeitung/Schnitt/Laubarbeit/Sonstiges), Bio-Status-Sperr-/Warnlogik bei Mittelwahl, neue Düngemittel-Stammdatentabelle, PSM-Erweiterungen (eppo_code, preis_pro_einheit), neue Behandlungsfelder (Bearbeitungstiefe/-gerät, Schnittart, Laubarbeit-Art, Einarbeitung), neue Sätze-Tabelle saetze_massnahmen; Migration 133',
   2.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-18', 4,
   'Hektarhöchstertrag-Warnung für Qualitätswein (10.000 kg/ha × Gesamt-AMA-Fläche, betriebsweit berechnet) in Erntemeldung Jahrgang-Detailseite – Hinweis vom BKI umgesetzt',
   1.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-18', 4,
   'Bio-Status-Auswahl in den Betriebseinstellungen (Admin → Mandanten → Betrieb → neuer Abschnitt "Bewirtschaftung"), aktiviert die Sperrlogik aus Maßnahmenformular Phase 2',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-18', 4,
   'Stundensätze-Verwaltung (neuer Tab im PSM-Lager für Hektarsätze je Maßnahmenart) + Kosten-Vorschlagsfunktion im Maßnahmenformular (schlägt Material-/Personalkosten automatisch vor und legt bei Bestätigung Kosteneintrag inkl. anteiliger Weingarten-Splits in der Kostenrechnung an)',
   1.5, 50);

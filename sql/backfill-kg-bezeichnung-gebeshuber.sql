-- Einmaliger Backfill: Katastralgemeinde-Bezeichnung fuer bereits importierte
-- Grundstuecke bei "Weingut Johannes Gebeshuber" nachtragen
--
-- Hintergrund: Der CSV-Datenimport hat kg_bezeichnung bisher nicht befuellt -
-- das Feld wurde nur im manuellen "Grundstueck bearbeiten"-Formular automatisch
-- aus der KGNr. ermittelt (Client-seitiger Lookup ueber
-- src/lib/wein/katastralgemeinden.ts), der Import-Endpunkt hat diesen Lookup
-- nie aufgerufen. Ist jetzt im Code nachgezogen (siehe
-- commit-import-kg-bezeichnung.ps1) - betrifft aber nur zukuenftige Importe.
-- Fuer die bereits importierten 129 Grundstuecke braucht es diesen einmaligen
-- Nachtrag.
--
-- Betroffene KGNr bei Gebeshuber (aus src/lib/wein/katastralgemeinden.ts):
--   16110 -> Gumpoldskirchen
--   4016  -> Kottingbrunn
--   4023  -> Pfaffstaetten
--   4033  -> Traiskirchen
--
-- Nur Zeilen mit kg_bezeichnung IS NULL werden angefasst, nur beim Mandanten
-- "Weingut Johannes Gebeshuber" (tenant_id unten). Bereits gepflegte Werte
-- bleiben unangetastet.

update grundstuecke
set kg_bezeichnung = case
  when katastralgemeinde in ('16110', '016110') then 'Gumpoldskirchen'
  when katastralgemeinde in ('4016', '04016')   then 'Kottingbrunn'
  when katastralgemeinde in ('4023', '04023')   then 'Pfaffstätten'
  when katastralgemeinde in ('4033', '04033')   then 'Traiskirchen'
  else kg_bezeichnung
end
where tenant_id = '097f67ed-381e-4bb3-952e-758aa9d3a501'
  and kg_bezeichnung is null
  and katastralgemeinde in ('16110', '016110', '4016', '04016', '4023', '04023', '4033', '04033');

-- Kontrolle: sollte danach 0 Zeilen mit bekannter KGNr aber ohne Bezeichnung mehr zeigen
select katastralgemeinde, kg_bezeichnung, count(*) as anzahl
from grundstuecke
where tenant_id = '097f67ed-381e-4bb3-952e-758aa9d3a501'
group by katastralgemeinde, kg_bezeichnung
order by katastralgemeinde;

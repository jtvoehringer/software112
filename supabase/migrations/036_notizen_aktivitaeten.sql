-- Migration 036: Notizen – nurAnzeige-Flag in Aktivitäten
-- Notizen und E-Mails sind spezielle Aktivitätsarten die nur zur Anzeige
-- verwendet werden, aber nicht im Kalender oder Aktivitätsformular auswähbar sind.
-- Die Steuerung erfolgt per AKTIVITAET_ARTEN-Konstante in src/lib/crm/types.ts
-- (nurAnzeige: true) – kein DB-Schema-Change notwendig.
-- Migration dient als Lückenhalter für die Nummerierungsfolge 035 → 037.

-- Sicherstellen dass aktivitaeten.art den 'notiz'-Wert unterstützt
-- (bereits durch CHECK-Constraint oder freies text-Feld abgedeckt)
DO $$ BEGIN
  RAISE NOTICE 'Migration 036: Notizen/E-Mail nurAnzeige – kein Schema-Change erforderlich';
END $$;

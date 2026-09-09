-- "trial" bei Weingut Johannes Gebeshuber auf "starter" setzen
--
-- tenants.plan ist rein informativ/Anzeige (nur in MandantDetailClient.tsx als
-- Text neben Slug/Erstelldatum verwendet) - hat KEINE Verbindung zu den
-- freigeschalteten Modulen. Die Module (Newsletter, CRM, Kellerbuch, Rieden,
-- E&A, SumUp, Export) laufen komplett unabhängig über die modul_*-Flags in
-- tenant_einstellungen ("Module"-Tab) - eine Plan-Änderung hier schaltet also
-- nichts frei oder ab.

update tenants
set plan = 'starter'
where name = 'Weingut Johannes Gebeshuber';

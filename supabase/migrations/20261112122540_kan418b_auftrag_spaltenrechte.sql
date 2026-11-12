-- KAN-418 Teil 1 (Nachtrag): Spaltenrechte für den Nummernkreis der Aufträge.
-- tenant_einstellungen hat für anon/authenticated nur Spaltenrechte (KAN-135) – neue Spalten sind ohne GRANT unsichtbar (DB-Test 01: spalte_ohne_grant).
GRANT SELECT (auftrag_prefix, auftrag_stellen, auftrag_zaehler) ON public.tenant_einstellungen TO authenticated, anon;

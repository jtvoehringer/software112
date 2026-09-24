DO $$
DECLARE
  p record;
  neu_qual text;
  neu_check text;
  n int := 0;
  fn_pattern text := 'user_has_role_in_tenant\(([\w.]+), (ARRAY\[[^\]]*\])\)';
  fn_ersatz  text := '(\1 IN (SELECT m.tenant_id FROM tenant_memberships m WHERE m.user_id = (select auth.uid()) AND m.aktiv AND m.role = ANY (\2)))';
BEGIN
  FOR p IN SELECT schemaname, tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' LOOP
    neu_qual  := p.qual;
    neu_check := p.with_check;
    IF neu_qual IS NOT NULL THEN
      neu_qual := regexp_replace(neu_qual, fn_pattern, fn_ersatz, 'g');
      neu_qual := regexp_replace(neu_qual, '(?<!select )auth\.uid\(\)', '(select auth.uid())', 'gi');
    END IF;
    IF neu_check IS NOT NULL THEN
      neu_check := regexp_replace(neu_check, fn_pattern, fn_ersatz, 'g');
      neu_check := regexp_replace(neu_check, '(?<!select )auth\.uid\(\)', '(select auth.uid())', 'gi');
    END IF;
    IF neu_qual IS DISTINCT FROM p.qual OR neu_check IS DISTINCT FROM p.with_check THEN
      IF p.cmd = 'INSERT' THEN
        EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)', p.policyname, p.schemaname, p.tablename, neu_check);
      ELSIF p.cmd IN ('SELECT', 'DELETE') THEN
        EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)', p.policyname, p.schemaname, p.tablename, neu_qual);
      ELSIF neu_check IS NOT NULL THEN
        EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)', p.policyname, p.schemaname, p.tablename, neu_qual, neu_check);
      ELSE
        EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)', p.policyname, p.schemaname, p.tablename, neu_qual);
      END IF;
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'RLS-Policies umgeschrieben: %', n;
END $$;
CREATE INDEX IF NOT EXISTS tenant_memberships_user_tenant_idx ON tenant_memberships (user_id, tenant_id, aktiv, role);
CREATE INDEX IF NOT EXISTS kontakte_firma_id_idx               ON kontakte (firma_id);
CREATE INDEX IF NOT EXISTS kontakte_rabattgruppe_id_idx        ON kontakte (rabattgruppe_id);
CREATE INDEX IF NOT EXISTS firmen_rabattgruppe_id_idx          ON firmen (rabattgruppe_id);
CREATE INDEX IF NOT EXISTS kontakt_praeferenzen_kontakt_idx    ON kontakt_praeferenzen (kontakt_id);
CREATE INDEX IF NOT EXISTS datenschutz_consents_kontakt_idx    ON datenschutz_consents (kontakt_id);
CREATE INDEX IF NOT EXISTS keller_umzuege_von_behaelter_idx    ON keller_umzuege (von_behaelter_id);
CREATE INDEX IF NOT EXISTS keller_umzuege_nach_behaelter_idx   ON keller_umzuege (nach_behaelter_id);
CREATE INDEX IF NOT EXISTS keller_behandlungen_typ_idx         ON keller_behandlungen (typ_id);
CREATE INDEX IF NOT EXISTS keller_behandlungen_tenant_idx      ON keller_behandlungen (tenant_id);
CREATE INDEX IF NOT EXISTS keller_freigaben_nutzer_idx         ON keller_freigaben (nutzer_tenant_id);
CREATE INDEX IF NOT EXISTS fuellung_chargen_tenant_idx         ON fuellung_chargen (tenant_id);
CREATE INDEX IF NOT EXISTS bestellung_positionen_bestellung_idx ON bestellung_positionen (bestellung_id);
CREATE INDEX IF NOT EXISTS bestellung_positionen_weinausbau_idx ON bestellung_positionen (weinausbau_id);
CREATE INDEX IF NOT EXISTS exportauftraege_firma_idx           ON exportauftraege (firma_id);
CREATE INDEX IF NOT EXISTS exportauftraege_kontakt_idx         ON exportauftraege (kontakt_id);
CREATE INDEX IF NOT EXISTS exportauftrag_positionen_auftrag_idx ON exportauftrag_positionen (exportauftrag_id);
CREATE INDEX IF NOT EXISTS ea_transaktionen_kategorie_idx      ON ea_transaktionen (kategorie_id);
CREATE INDEX IF NOT EXISTS ea_transaktionen_bmd_export_idx     ON ea_transaktionen (bmd_export_id);
CREATE INDEX IF NOT EXISTS ea_anlagen_transaktion_idx          ON ea_anlagen (transaktion_id);
CREATE INDEX IF NOT EXISTS ea_dauerauftraege_kategorie_idx     ON ea_dauerauftraege (kategorie_id);
CREATE INDEX IF NOT EXISTS ea_dauerauftraege_konto_idx         ON ea_dauerauftraege (konto_id);
CREATE INDEX IF NOT EXISTS kosteneintraege_tenant_idx          ON kosteneintraege (tenant_id);
CREATE INDEX IF NOT EXISTS kosteneintraege_kostenart_idx       ON kosteneintraege (kostenart_id);
CREATE INDEX IF NOT EXISTS kosteneintraege_kostenstelle_idx    ON kosteneintraege (kostenstelle_id);
CREATE INDEX IF NOT EXISTS kosteneintraege_behaelter_idx       ON kosteneintraege (behaelter_id);
CREATE INDEX IF NOT EXISTS kosteneintraege_weingarten_idx      ON kosteneintraege (weingarten_id);
CREATE INDEX IF NOT EXISTS kosteneintraege_ried_idx            ON kosteneintraege (ried_id);
CREATE INDEX IF NOT EXISTS kosteneintrag_behaelter_behaelter_idx ON kosteneintrag_behaelter (behaelter_id);
CREATE INDEX IF NOT EXISTS kosteneintrag_weingaerten_wg_idx    ON kosteneintrag_weingaerten (weingarten_id);
CREATE INDEX IF NOT EXISTS kostenarten_tenant_idx              ON kostenarten (tenant_id);
CREATE INDEX IF NOT EXISTS ernte_parzellen_rebsorte_idx        ON ernte_parzellen (rebsorte_id);
CREATE INDEX IF NOT EXISTS ama_meldepositionen_rebsorte_idx    ON ama_meldepositionen (rebsorte_id);;

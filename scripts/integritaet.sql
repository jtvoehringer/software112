-- Fachliche Stimmigkeit der Daten (Sweep 106, 10.10.2026) – nur lesend, Erwartung: 0 Zeilen.
-- Als postgres ausführen (SQL-Editor oder MCP execute_sql), sonst blendet RLS Zeilen aus. Ergänzt scripts/fk-waisen.sql
-- (Fremdschlüssel) und journal_konsistenz(tenant) (Kellerbuch-Journal gegen Ist). Ausführen nach Datenkorrekturen, vor
-- dem Pilot-Reset Gebeshuber (Mitte Dez. 2026) und vor Releases mit Bestands- oder Zahlungslogik.
-- Stand 10.10.2026 in Produktion (alle vier Betriebe): 0 Zeilen.
select 'charge_negativ' as pruefung, t.name as betrieb, count(*) as anzahl
  from weinausbau w join tenants t on t.id = w.tenant_id
 where w.storniert_am is null and w.menge_liter < -0.005
 group by 1, 2
union all
-- offene Chargen eines Behälters zusammen über dem Volumen (0,5 L Toleranz)
select 'behaelter_ueberfuellt', t.name, count(*)
  from (select b.id, b.tenant_id, b.volumen_liter, sum(w.menge_liter) as summe
          from behaelter b join weinausbau w on w.behaelter_id = b.id and w.storniert_am is null and w.status <> 'abgeschlossen'
         group by 1, 2, 3) x
  join tenants t on t.id = x.tenant_id
 where x.volumen_liter > 0 and x.summe > x.volumen_liter + 0.5
 group by 1, 2
union all
select 'flaschen_negativ', t.name, count(*)
  from fuellungen f join tenants t on t.id = f.tenant_id
 where f.storniert_am is null and (f.bestand_flaschen < 0 or f.bestand_unetikettiert < 0)
 group by 1, 2
union all
select 'unetikettiert_ueber_bestand', t.name, count(*)
  from fuellungen f join tenants t on t.id = f.tenant_id
 where f.storniert_am is null and f.bestand_unetikettiert > f.bestand_flaschen
 group by 1, 2
union all
select 'bestand_ueber_abgefuellt', t.name, count(*)
  from fuellungen f join tenants t on t.id = f.tenant_id
 where f.storniert_am is null and f.bestand_flaschen > f.anzahl_flaschen
 group by 1, 2
union all
select 'verkauf_bezahlt_ohne_zahlung', t.name, count(*)
  from verkaufsposten v join tenants t on t.id = v.tenant_id
 where v.aktiv and not v.storniert and v.bezahlt
   and not exists (select 1 from zahlungen z where z.verkaufsposten_id = v.id and z.storniert_am is null)
 group by 1, 2
union all
select 'rechnung_bezahlt_ohne_zahlung', t.name, count(*)
  from rechnungen r join tenants t on t.id = r.tenant_id
 where r.aktiv and not r.storniert and r.bezahlt
   and not exists (select 1 from zahlungen z where z.rechnung_id = r.id and z.storniert_am is null)
 group by 1, 2
union all
select 'zahlung_auf_storniertem_beleg', t.name, count(*)
  from zahlungen z join tenants t on t.id = z.tenant_id
  left join verkaufsposten v on v.id = z.verkaufsposten_id
  left join rechnungen r on r.id = z.rechnung_id
 where z.storniert_am is null and (coalesce(v.storniert, false) or coalesce(r.storniert, false))
 group by 1, 2
union all
-- Kellerbuch-Journal gegen Ist (Funktion journal_konsistenz je Betrieb)
select 'journal_' || k.art, t.name, count(*)
  from tenants t cross join lateral public.journal_konsistenz(t.id) k
 group by 1, 2
order by 1, 2;

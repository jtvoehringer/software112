-- Prüfnummern-Altdaten (KAN-72, 25.9.2026) – nur lesend.
-- Als postgres ausführen (SQL-Editor oder MCP execute_sql), sonst blendet RLS Zeilen aus.
--
-- Regel wie src/lib/kellerbuch/pruefnummer.ts (pruefnummerGueltig): eine Prüfnummer gilt für
-- eine Charge, wenn der zuletzt eingereichte Antrag genehmigt und aktiv ist, eine Nummer trägt,
-- nach eingereicht_am (am Einreichungstag: davor; ohne Datum: Anlagetag, dann Bescheidtag) kein
-- Verschnitt, Zukauf (aktiv) oder Zugang (Umzug aus einer anderen Charge, Pressung) mit der
-- Charge als ZIEL gebucht wurde und der Bestand höchstens beantragt − seither abgefüllt ist.
--
-- Ergebnis: eine Zeile je Betrieb und Befund mit Anzahl und gekürzten IDs („…“ + letzte 8
-- Zeichen). Details: die letzte Abfrage durch „select * from befunde“ ersetzen.
--
-- Befunde Füllungen (nur aktive):
--   A1  dac_antrag_id zeigt auf den Antrag einer anderen Charge (oder die Füllung hat keine Charge)
--   A2  Prüfnummer weicht von der des verknüpften Antrags ab
--   A3  Prüfnummer gesetzt, verknüpfter Antrag aber nicht genehmigt/aktiv
--   A4  freie Prüfnummer (ohne Antrag) gehört zum Antrag einer anderen Charge – bzw. ohne Charge
--       zu irgendeinem Antrag (typisch: beim Chargenwechsel stehen geblieben)
--   A5  freie Prüfnummer auf einer Charge mit aktivem, nicht abgelehntem Antrag, aber nicht
--       dessen Nummer
--   A6  Prüfnummer = Nummer eines Antrags der eigenen Charge, aber ohne dac_antrag_id (nur Info)
--   A7  Nummer eines Antrags der eigenen Charge, abgefüllt NACH einem Zugang/Verschnitt/Zukauf
--       seit dessen Einreichung (Nummer galt am Abfülltag nicht mehr)
-- Befunde Chargen:
--   B1  angezeigte Nummer wäre nach der neuen Regel heute ungültig (Grund angehängt)
--   B2  Blend-Protokoll zeigte bisher eine andere Nummer (jüngster Antrag mit Nummer, ohne Status)
--   B3  TBS-Vorbelegung (Tank) belegte bisher eine andere Nummer vor (ältester Antrag mit Nummer)
with
heute as (select (now() at time zone 'Europe/Vienna')::date as tag),
antrag as (
  select a.*,
         coalesce(a.eingereicht_am, (a.created_at at time zone 'Europe/Vienna')::date, a.bescheid_am) as beginn,
         upper(regexp_replace(coalesce(a.pruefnummer, ''), '\s', '', 'g')) as pn_norm,
         (a.status = 'genehmigt' and a.aktiv and nullif(btrim(a.pruefnummer), '') is not null) as genehmigt
  from dac_antrag a
),
-- Buchungen mit der Charge als ZIEL (Abgänge – Füllung, Tankverkauf, Schwund, Quelle – zählen nicht)
zugang as (
  select v.tenant_id, v.ziel_weinausbau_id as charge, v.datum, 'verschnitt'::text as art, 0 as rang
  from verschneidungen v where v.ziel_weinausbau_id is not null
  union all
  select z.tenant_id, z.ziel_weinausbau_id, z.datum, 'zukauf', 1
  from zukauf_posten z where z.aktiv and z.ziel_weinausbau_id is not null
  union all
  select u.tenant_id, u.nach_weinausbau_id, u.datum, 'zugang', 2
  from keller_umzuege u
  where u.nach_weinausbau_id is not null and coalesce(u.zeilen_typ, '') <> 'quelle'
    and case
          when u.von_weinausbau_id is not null then u.von_weinausbau_id <> u.nach_weinausbau_id
          else not exists (select 1 from keller_umzuege q
                           where q.tenant_id = u.tenant_id and q.umzug_batch_id = u.umzug_batch_id and q.zeilen_typ = 'quelle')
            or exists (select 1 from keller_umzuege q
                       where q.tenant_id = u.tenant_id and q.umzug_batch_id = u.umzug_batch_id and q.zeilen_typ = 'quelle'
                         and q.von_weinausbau_id is distinct from u.nach_weinausbau_id)
        end
  union all
  select p.tenant_id, pb.weinausbau_id, p.datum, 'zugang', 2
  from pressung_behaelter pb join pressungen p on p.id = pb.pressung_id
  where pb.weinausbau_id is not null
),
-- Füllungen je Charge wie der Lader: fuellung_chargen hat Vorrang, sonst fuellungen.weinausbau_id
abfuellung as (
  select fc.tenant_id, fc.weinausbau_id as charge, f.id, f.datum, f.dac_antrag_id, fc.anteil_liter as liter
  from fuellung_chargen fc join fuellungen f on f.id = fc.fuellung_id and f.tenant_id = fc.tenant_id
  where f.aktiv
  union all
  select f.tenant_id, f.weinausbau_id, f.id, f.datum, f.dac_antrag_id,
         coalesce(f.menge_liter_gefuellt, f.anzahl_flaschen * f.flaschengroesse_ml / 1000.0)
  from fuellungen f
  where f.aktiv and f.weinausbau_id is not null
    and not exists (select 1 from fuellung_chargen fc where fc.fuellung_id = f.id and fc.weinausbau_id = f.weinausbau_id)
),
-- maßgeblicher Antrag je Charge: zuletzt eingereichter genehmigter bis heute
massgeblich as (
  select distinct on (a.weinausbau_id) a.*
  from antrag a, heute h
  where a.genehmigt and a.weinausbau_id is not null and (a.beginn is null or a.beginn <= h.tag)
  order by a.weinausbau_id, a.beginn desc nulls last, a.id desc
),
charge_pruefung as (
  select m.tenant_id, m.weinausbau_id as charge, m.id as antrag_id, m.pruefnummer,
         (select z.art || ' am ' || to_char(z.datum, 'DD.MM.YYYY')
            from zugang z, heute h
           where z.tenant_id = m.tenant_id and z.charge = m.weinausbau_id
             and z.datum > m.beginn and z.datum <= h.tag
           order by z.datum, z.rang limit 1) as erster_zugang,
         w.menge_liter as bestand,
         m.menge_liter as beantragt,
         (select coalesce(sum(ab.liter), 0) from abfuellung ab
           where ab.tenant_id = m.tenant_id and ab.charge = m.weinausbau_id
             and (ab.dac_antrag_id = m.id or ab.datum > m.beginn)) as abgefuellt
  from massgeblich m
  join weinausbau w on w.id = m.weinausbau_id and w.tenant_id = m.tenant_id
),
charge_ergebnis as (
  select c.*,
         case
           when c.erster_zugang is not null then c.erster_zugang
           when c.beantragt is not null and c.bestand > c.beantragt - c.abgefuellt + 0.005
             then 'menge: Bestand ' || c.bestand || ' l > ' || (c.beantragt - c.abgefuellt) || ' l'
         end as grund
  from charge_pruefung c
),
neu as (   -- gültige Nummer je Charge nach der neuen Regel (fehlt = keine)
  select tenant_id, charge, pruefnummer from charge_ergebnis where grund is null
),
alt_blend as (
  select distinct on (weinausbau_id) tenant_id, weinausbau_id as charge, pruefnummer
  from dac_antrag
  where weinausbau_id is not null and nullif(btrim(pruefnummer), '') is not null
  order by weinausbau_id, created_at desc
),
alt_tbs as (
  select distinct on (weinausbau_id) tenant_id, weinausbau_id as charge, pruefnummer
  from dac_antrag
  where weinausbau_id is not null and nullif(btrim(pruefnummer), '') is not null
  order by weinausbau_id, created_at asc, id asc
),
fuellung as (
  select f.*, upper(regexp_replace(coalesce(f.pruefnummer, ''), '\s', '', 'g')) as pn_norm
  from fuellungen f where f.aktiv
),
befunde as (
  select f.tenant_id, 'A1 Füllung mit DAC-Antrag einer anderen Charge' as befund, f.id
  from fuellung f join dac_antrag a on a.id = f.dac_antrag_id
  where a.weinausbau_id is distinct from f.weinausbau_id or a.tenant_id <> f.tenant_id
  union all
  select f.tenant_id, 'A2 Prüfnummer weicht vom verknüpften Antrag ab', f.id
  from fuellung f join antrag a on a.id = f.dac_antrag_id
  where f.pn_norm <> '' and f.pn_norm <> a.pn_norm
  union all
  select f.tenant_id, 'A3 Prüfnummer, verknüpfter Antrag nicht genehmigt/aktiv', f.id
  from fuellung f join antrag a on a.id = f.dac_antrag_id
  where f.pn_norm <> '' and not a.genehmigt
  union all
  select f.tenant_id, 'A4 freie Prüfnummer gehört zu einer anderen Charge', f.id
  from fuellung f
  where f.dac_antrag_id is null and f.pn_norm <> ''
    and exists (select 1 from antrag a where a.tenant_id = f.tenant_id and a.pn_norm = f.pn_norm
                  and a.weinausbau_id is distinct from f.weinausbau_id)
  union all
  select f.tenant_id, 'A5 freie Prüfnummer trotz DAC-Antrag der Charge', f.id
  from fuellung f
  where f.dac_antrag_id is null and f.pn_norm <> '' and f.weinausbau_id is not null
    and exists (select 1 from antrag a where a.tenant_id = f.tenant_id and a.weinausbau_id = f.weinausbau_id
                  and a.aktiv and a.status <> 'abgelehnt')
    and not exists (select 1 from antrag a where a.tenant_id = f.tenant_id and a.weinausbau_id = f.weinausbau_id
                      and a.pn_norm = f.pn_norm)
  union all
  select f.tenant_id, 'A6 Nummer des eigenen Antrags ohne Verknüpfung (Info)', f.id
  from fuellung f
  where f.dac_antrag_id is null and f.pn_norm <> '' and f.weinausbau_id is not null
    and exists (select 1 from antrag a where a.tenant_id = f.tenant_id and a.weinausbau_id = f.weinausbau_id
                  and a.pn_norm = f.pn_norm)
  union all
  select f.tenant_id, 'A7 abgefüllt nach Zugang seit Einreichung', f.id
  from fuellung f
  join antrag a on a.tenant_id = f.tenant_id and a.weinausbau_id = f.weinausbau_id
               and (a.id = f.dac_antrag_id or (f.pn_norm <> '' and a.pn_norm = f.pn_norm))
  where exists (select 1 from zugang z where z.tenant_id = f.tenant_id and z.charge = f.weinausbau_id
                  and z.datum > a.beginn and z.datum <= f.datum)
  union all
  select c.tenant_id, 'B1 Charge: Prüfnummer heute ungültig – ' || rtrim(split_part(c.grund, ' ', 1), ':'), c.charge
  from charge_ergebnis c where c.grund is not null
  union all
  select a.tenant_id, 'B2 Charge: Blend-Protokoll zeigte bisher andere Nummer', a.charge
  from alt_blend a left join neu n on n.charge = a.charge and n.tenant_id = a.tenant_id
  where a.pruefnummer is distinct from n.pruefnummer
  union all
  select a.tenant_id, 'B3 Charge: TBS belegte bisher andere Nummer vor', a.charge
  from alt_tbs a left join neu n on n.charge = a.charge and n.tenant_id = a.tenant_id
  where a.pruefnummer is distinct from n.pruefnummer
)
select t.name as betrieb,
       b.befund,
       count(distinct b.id) as anzahl,
       string_agg(distinct '…' || right(b.id::text, 8), ', ') as ids_gekuerzt
from befunde b
join tenants t on t.id = b.tenant_id
group by t.name, b.befund
order by t.name, b.befund;

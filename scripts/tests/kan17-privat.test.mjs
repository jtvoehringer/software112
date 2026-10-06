// KAN-17 (06.10.2026): Private Aktivitäten – nur der Ersteller sieht sie (DB-Policy akt_privat, DB-Test 45); andere
// Mitglieder sehen im Kalender nur den Zeitblock „Privat“ (RPC s112_privat_bloecke), ohne Inhalt und nicht anklickbar.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

describe('KAN-17 Private Aktivitäten', () => {
  test('Migration: RESTRICTIVE-Policies für Aktivitäten und Anhänge, RPC nur mit Zeitangaben', () => {
    const f = readdirSync(path.join(WURZEL, 'supabase/migrations')).find(n => n.endsWith('_kan17_aktivitaeten_privat.sql'))
    const m = quelle(f ? path.join('supabase/migrations', f) : 'supabase/entwurf/kan17_aktivitaeten_privat.sql')
    assert.match(m, /CREATE POLICY akt_privat ON public\.aktivitaeten AS RESTRICTIVE FOR SELECT TO authenticated\s+USING \(NOT coalesce\(ist_privat, false\) OR erstellt_von = \(SELECT auth\.uid\(\)\)\)/)
    assert.match(m, /CREATE POLICY akt_dok_privat ON public\.aktivitaet_dokumente AS RESTRICTIVE FOR SELECT/)
    const rpc = m.slice(m.indexOf('CREATE OR REPLACE FUNCTION public.s112_privat_bloecke'))
    assert.match(rpc, /PERFORM public\.pruefe_tenant_zugriff\(p_tenant_id, NULL\)/)
    assert.doesNotMatch(rpc.slice(0, rpc.indexOf('$function$;')), /betreff|beschreibung|kontakt_id|firma_id/)
  })
  test('Kalender: fremde private Termine als Block „Privat“, kein Detail-Dialog, nicht verschiebbar', () => {
    const p = quelle('src/app/(dashboard)/crm/page.tsx')
    assert.match(p, /rpc as any\)\('s112_privat_bloecke', \{ p_tenant_id: tenantId \}\)/)
    assert.match(p, /typ: 'privat',/)
    assert.match(p, /titel: 'Privat',/)
    const c = quelle('src/app/(dashboard)/crm/CRMUebersichtClient.tsx')
    assert.match(c, /const zeigeEintrag = \(e: KalenderEintrag\) => \{ if \(e\.typ !== 'privat'\) setViewAkt\(e\) \}/)
    assert.doesNotMatch(c, /onClick=\{\(\) => setViewAkt\(e\)\}|onViewAkt=\{setViewAkt\}/)
    assert.match(c, /const isAkt  = e\.typ === 'aktivitaet'/)   // nur eigene Aktivitäten sind ziehbar
  })
})

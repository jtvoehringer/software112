import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { BarChart3 } from 'lucide-react'
import BehandlungenClient from './BehandlungenClient'
import { ladeErnteSperren } from '@/lib/behandlungen/ernteSperre'
import { ladePsmUebermittlungsStand } from '@/lib/uebermittlung/psm/laden'
import { STATUS_TEXT, type UebermittlungsStatus } from '@/lib/uebermittlung/psm/stand'
import UebermittlungPanel, { type UebermittlungUebersicht } from './UebermittlungPanel'
import { erfassungsAmpel, erfassungsverzugH, fristAus, fristRelevant, nacherfasstText, type ErfassungsAmpel } from '@/lib/behandlungen/erfassungsfrist'
import { heuteWien } from '@/lib/datum/wien'

export const metadata: Metadata = { title: 'Maßnahmen – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export type Behandlung = {
  id: string
  datum: string
  art: string
  weingarten_id: string | null
  weingarten_name: string | null
  weingarten_ried: string | null
  /** Rieden der Maßnahme (aus den Grundstücken bzw. weingarten_id), alphabetisch */
  rieden: string[]
  /** Σ Fläche der Grundstücke der Maßnahme (ha) */
  flaeche_ha: number | null
  psm_name: string | null
  psm_wartezeit: number | null
  aufwandmenge: number | null
  aufwandmenge_einheit: string | null
  bbch_stadium: string | null
  witterung: string | null
  ernte_fruehesteins: string | null
  notizen: string | null
  kosten_betrag: number | null
  /** KAN-88: storniert (bleibt gekennzeichnet in der Liste) */
  storniert_am: string | null
  storniert_von_name: string | null
  storno_grund: string | null
  /** KAN-87: „nacherfasst (+n h)“ über der Erfassungsfrist (Pflanzenschutz und Düngung), sonst null */
  nacherfasst: string | null
  erfassung_ampel: ErfassungsAmpel | null
  /** KAN-169: Datum der Lese, die die Maßnahme sperrt (Ried nach der Maßnahme gelesen), sonst null */
  ernte_gesperrt: string | null
  /** KAN-120: Übermittlungsstatus der Pflanzenschutz-Aufzeichnung (nur Maßnahmen mit Mittel), sonst null */
  uebermittlung: { status: UebermittlungsStatus; text: string; am: string | null } | null
}

export default async function BehandlungenPage() {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role, 'rieden')
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // Behandlungen + PSM; die Rieden kommen aus den Grundstücken der Maßnahme (eingebettet über die mandantengefilterte
  // Maßnahme – eine eigene Abfrage auf behandlung_grundstuecke war ungefiltert und bei vielen GST auf 1.000 Zeilen gekappt)
  const [{ data: rawB }, { data: rawKosten }, { data: rawEinst }] = await Promise.all([
    // storno-sichtbar: die Liste zeigt stornierte Maßnahmen gekennzeichnet (Endgültig löschen), sie zählen nirgends (KAN-88)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('behandlungen') as any)
      .select(`
        id, datum, datum_bis, created_at, psm_id, art, storniert_am, storniert_von_name, storno_grund, weingarten_id, aufwandmenge, aufwandmenge_einheit,
        bbch_stadium, witterung, ernte_fruehesteins, notizen,
        weingarten:weingarten_id ( name, ried ),
        psm:psm_id ( name, wartezeit_tage ),
        behandlung_grundstuecke ( flaeche_ha, grundstueck:grundstueck_id ( flaeche_ha, weingarten:weingarten_id ( id, name, ried ) ) )
      `)
      .order('datum', { ascending: false })
      .limit(200)),

    // Kosten je Maßnahme (Punkt 7, Migration 139)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle(tf((supabase.from('kosteneintraege') as any)
      .select('behandlung_id, betrag')
      .not('behandlung_id', 'is', null)
      .order('id'))),   // alle(): Summe je Maßnahme sonst ab dem 1.001. Kosteneintrag zu niedrig
    // KAN-87: Erfassungsfrist des Betriebs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('tenant_einstellungen') as any).select('psm_erfassungsfrist_h')).maybeSingle(),
  ])
  const psmFristH = fristAus((rawEinst as AR | null)?.psm_erfassungsfrist_h)

  const kostenByBeh = new Map<string, number>()
  for (const k of ((rawKosten ?? []) as AR[])) {
    if (!k.behandlung_id) continue
    kostenByBeh.set(k.behandlung_id, (kostenByBeh.get(k.behandlung_id) ?? 0) + (k.betrag ?? 0))
  }

  const KOLLATOR = new Intl.Collator('de', { numeric: true, sensitivity: 'base' })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const behandlungenRoh = ((rawB ?? []) as any[]).map((b: any) => {
    // Rieden aus den Grundstücken der Maßnahme (alphabetisch), sonst die Ried aus weingarten_id
    const bgs = (b.behandlung_grundstuecke ?? []) as AR[]
    const wgs = new Map<string, AR>()
    for (const bg of bgs) { const wg = bg.grundstueck?.weingarten; if (wg?.id && !wgs.has(wg.id)) wgs.set(wg.id, wg) }
    const rieden = wgs.size > 0
      ? [...wgs.values()].map(w => String(w.name ?? '–')).sort(KOLLATOR.compare)
      : b.weingarten?.name ? [String(b.weingarten.name)] : []
    const flaeche = bgs.reduce((s: number, bg: AR) => s + (Number(bg.flaeche_ha ?? bg.grundstueck?.flaeche_ha) || 0), 0)
    const erste = wgs.values().next().value as AR | undefined
    const wgName = rieden.length > 0 ? rieden.join(', ') : null
    const wgRied = b.weingarten?.ried ?? erste?.ried ?? null
    const wgId   = b.weingarten_id ?? erste?.id ?? null
    const verzug = fristRelevant(b) && !b.storniert_am ? erfassungsverzugH({ datum: b.datum, datumBis: b.datum_bis }, b.created_at) : null

    return {
      id:                   b.id,
      datum:                b.datum,
      art:                  b.art ?? 'spritzung',
      weingarten_id:        wgId,
      weingarten_name:      wgName,
      weingarten_ried:      wgRied,
      rieden,
      flaeche_ha:           flaeche > 0 ? Math.round(flaeche * 10000) / 10000 : null,
      psm_name:             b.psm?.name ?? null,
      psm_wartezeit:        b.psm?.wartezeit_tage ?? null,
      aufwandmenge:         b.aufwandmenge,
      aufwandmenge_einheit: b.aufwandmenge_einheit,
      bbch_stadium:         b.bbch_stadium,
      witterung:            b.witterung,
      ernte_fruehesteins:   b.ernte_fruehesteins,
      notizen:              b.notizen,
      kosten_betrag:        kostenByBeh.get(b.id) ?? null,
      storniert_am:         b.storniert_am ?? null,
      storniert_von_name:   b.storniert_von_name ?? null,
      storno_grund:         b.storno_grund ?? null,
      nacherfasst:          nacherfasstText(verzug, psmFristH),
      erfassung_ampel:      verzug === null ? null : erfassungsAmpel(verzug, psmFristH),
      ernte_gesperrt:       null,
      uebermittlung:        null as Behandlung['uebermittlung'],
      riedIds:              [...new Set([...(b.weingarten_id ? [b.weingarten_id as string] : []), ...wgs.keys()])],
    }
  })
  // KAN-169: Maßnahmen, deren Ried nach dem Maßnahmendatum gelesen wurde – dieselbe Regel wie der Trigger a_freeze_ernte
  const ernteSperren = tenantId
    ? await ladeErnteSperren(supabase, tenantId, behandlungenRoh.filter(b => !b.storniert_am).map(b => ({ id: b.id, datum: b.datum, rieden: b.riedIds })))
    : new Map<string, string>()
  // KAN-120: Übermittlungsstand je Pflanzenschutz-Aufzeichnung (Hash der Exportzeilen gegen den letzten Export)
  const uStand = tenantId ? await ladePsmUebermittlungsStand(supabase, tenantId).catch(() => null) : null
  const uJeId = new Map((uStand?.stand ?? []).map(s => [s.behandlungId, s]))
  const uebersicht: UebermittlungUebersicht = {
    offen: (uStand?.stand ?? []).filter(s => s.status === 'offen').length,
    korrektur: (uStand?.stand ?? []).filter(s => s.status === 'korrektur').length,
    letzterLauf: uStand?.laeufe[0] ?? null,
  }
  const behandlungen: Behandlung[] = behandlungenRoh.map(({ riedIds: _r, ...b }) => {
    const u = uJeId.get(b.id)
    return {
      ...b,
      ernte_gesperrt: ernteSperren.get(b.id) ?? null,
      uebermittlung: u ? { status: u.status, text: STATUS_TEXT[u.status], am: u.letzterExport?.exportiert_am ?? null } : null,
    }
  })

  // Stats
  const heute = heuteWien()
  // eslint-disable-next-line react-hooks/purity -- Server-Komponente: Zeitpunkt je Anfrage ist gewollt, kein erneutes Rendern im Browser
  const letzten30 = behandlungen.filter(b => b.datum >= new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]).length
  const offeneWartezeiten = behandlungen.filter(b => b.ernte_fruehesteins && b.ernte_fruehesteins > heute).length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Maßnahmen</h1>
          <p className="text-sm text-s112-muted mt-0.5">Pflanzenschutz-Protokoll</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/behandlungen/berichte"
            className="inline-flex items-center gap-2 border border-s112-border text-s112-text-1 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-bg transition-colors"
          >
            <BarChart3 className="w-4 h-4" /> Berichte
          </Link>
          {writeOk && (
            <Link
              href="/behandlungen/neu"
              className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 transition-colors"
            >
              Neue Maßnahme
            </Link>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card text-center">
          <p className="text-3xl font-semibold text-s112-blue-700">{behandlungen.length}</p>
          <p className="text-xs text-s112-muted mt-1">Maßnahmen gesamt</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-semibold text-s112-blue-700">{letzten30}</p>
          <p className="text-xs text-s112-muted mt-1">Letzte 30 Tage</p>
        </div>
        <div className="card text-center">
          <p className={`text-3xl font-semibold ${offeneWartezeiten > 0 ? 'text-s112-warn-fg' : 'text-s112-blue-700'}`}>
            {offeneWartezeiten}
          </p>
          <p className="text-xs text-s112-muted mt-1">Offene Wartezeiten</p>
        </div>
      </div>

      {uStand && <UebermittlungPanel uebersicht={uebersicht} schreibOk={writeOk} />}

      <BehandlungenClient behandlungen={behandlungen} schreibOk={writeOk} />
    </div>
  )
}

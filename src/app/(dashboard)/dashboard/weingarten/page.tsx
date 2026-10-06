import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { Grape, FlaskConical, Clock, MapPin } from 'lucide-react'
import RiedKarte, { type KartenPin } from '@/components/weingarten/RiedKarte'
import { googleMapsUrl } from '@/lib/geo/rieden'
import { DashHeader, Tile, Card, Badge, Note, Empty, Th, Td, fmtNum, fmtDate } from '../_shared/ui'
import { getCtx, ladeWeingarten, type R } from '../_shared/data'
import { canWrite } from '@/lib/auth/roles'
import LeseCheckliste, { type Punkt } from './LeseCheckliste'

export const metadata: Metadata = { title: 'Weingarten & Ernte – software:112' }
export const dynamic = 'force-dynamic'

// ── Sicht "Weingarten & Ernte" (Dashboard-Relaunch 27.8.2026) ────────────────

export default async function WeingartenSichtPage() {
  const ctx = await getCtx()
  const jahr = ctx.heute.getFullYear()
  const [wg, { data: listeRaw }] = await Promise.all([
    ladeWeingarten(ctx),
    ctx.tf(ctx.q('checklisten').select('id, name, jahr, checklisten_punkte(id, text, zustaendig, faellig_am, faellig_hinweis, erledigt, sortierung)').eq('typ', 'lese').eq('jahr', jahr).maybeSingle()),
  ])
  const liste = (listeRaw ?? null) as R | null
  const punkte: Punkt[] = ((liste?.checklisten_punkte ?? []) as R[])
    .sort((a, b) => (a.sortierung ?? 0) - (b.sortierung ?? 0))
    .map(p => ({ id: p.id, text: p.text, zustaendig: p.zustaendig ?? null, faellig_am: p.faellig_am ?? null, faellig_hinweis: p.faellig_hinweis ?? null, erledigt: !!p.erledigt }))
  const naechsteWf = wg.wartefristen[0]

  // Karte: ein Pin je Ried (Riedenebene – mehrere Weingarten-Zeilen derselben
  // Ried tragen denselben Pin, deshalb nach Ried-Name + Koordinate zusammenfassen)
  const pinMap = new Map<string, KartenPin>()
  for (const r of wg.rieden) {
    if (r.lat == null || r.lon == null) continue
    const key = `${r.ried ?? r.name}|${r.lat.toFixed(5)}|${r.lon.toFixed(5)}`
    if (!pinMap.has(key)) pinMap.set(key, { id: r.id, name: r.ried ?? r.name, lat: r.lat, lon: r.lon, sub: [r.rebsorte, `${fmtNum(r.flaeche_ha, 2)} ha`].filter(Boolean).join(' · '), href: `/weingarten/${r.id}` })
  }
  const pins = Array.from(pinMap.values())
  const ohneKoordinaten = wg.rieden.filter(r => r.lat == null).length

  return (
    <div className="space-y-6">
      <DashHeader
        title="Weingarten & Ernte"
        sub={<>Rieden, Grundstücke und Behandlungen – inklusive AMA-Stammdaten (Feldstück, Codes) und Vorbereitung auf die Lese {jahr}.</>}
        right={<Link href="/weingarten" className="text-[12.5px] text-s112-blue-700 hover:underline whitespace-nowrap">Zu den Rieden →</Link>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <Tile label="Rieden / Grundstücke" icon={Grape} href="/weingarten"
          value={`${fmtNum(wg.rieden.length)} / ${fmtNum(wg.grundstueckeCount)}`}
          sub={`${fmtNum(wg.flaecheHa, 2)} ha Rebfläche`} />
        <Tile label={`Behandlungen ${jahr}`} icon={FlaskConical} href="/behandlungen"
          value={fmtNum(wg.behandlungenSaison)}
          sub="PSM-Dokumentation je Grundstück" />
        <Tile label="Wartefristen aktiv" icon={Clock} href="/behandlungen"
          value={fmtNum(wg.wartefristen.length)}
          sub={naechsteWf ? `${naechsteWf.ried} · frei ab ${fmtDate(naechsteWf.freiAb)}` : 'Keine laufende Wartefrist'}
          tone={wg.wartefristen.length > 0 ? 'warn' : 'ok'} />
      </div>

      <Card title="Rieden-Karte" right={
        <span className="text-[11.5px] text-s112-text-2">
          {pins.length} Ried{pins.length === 1 ? '' : 'en'} mit Koordinaten{ohneKoordinaten > 0 ? ` · ${ohneKoordinaten} ohne` : ''} · <Link href="/api/export/rieden-geo?format=gpx" className="text-s112-blue-700 hover:underline">GPX</Link> · <Link href="/api/export/rieden-geo?format=kml" className="text-s112-blue-700 hover:underline">KML</Link>
        </span>
      }>
        {pins.length === 0 ? (
          <Empty action={{ href: '/weingarten', label: 'Rieden öffnen und Pin setzen' }}>Noch keine Ried mit Koordinaten – in der Ried-Detailseite auf die Karte klicken oder den Standort übernehmen.</Empty>
        ) : (
          <RiedKarte pins={pins} height={300} />
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Rieden – Übersicht" right={<Link href="/weingarten" className="text-[11.5px] text-s112-blue-700 hover:underline">alle →</Link>}>
          {wg.rieden.length === 0 ? (
            <Empty action={{ href: '/weingarten/neu', label: 'Erste Ried anlegen' }}>Noch keine Rieden angelegt.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr><Th>Ried</Th><Th>Rebsorte(n)</Th><Th right>Fläche</Th><Th right>GST</Th><Th>AMA-FS</Th><Th>Codes</Th><Th>Lage</Th></tr></thead>
                <tbody>
                  {wg.rieden.slice(0, 12).map(r => (
                    <tr key={r.id} className="hover:bg-s112-bg">
                      <Td><Link href={`/weingarten/${r.id}`} className="font-semibold text-s112-text hover:text-s112-blue-700">{r.name}</Link>{r.ried && r.ried !== r.name && <span className="block text-[11.5px] text-s112-tertiary">{r.ried}</span>}</Td>
                      <Td>{r.rebsorte ?? '–'}</Td>
                      <Td right mono>{fmtNum(r.flaeche_ha, 2)} ha</Td>
                      <Td right mono>{r.gstCount}</Td>
                      <Td mono>{r.amaFs.length ? r.amaFs.slice(0, 3).join(', ') + (r.amaFs.length > 3 ? ' …' : '') : '–'}</Td>
                      <Td>{r.codes.length ? <span className="flex flex-wrap gap-1">{r.codes.slice(0, 3).map(c => <Badge key={c} tone="info">{c}</Badge>)}</span> : '–'}</Td>
                      <Td>{r.lat != null && r.lon != null
                        ? <a href={googleMapsUrl(r.lat, r.lon)} target="_blank" rel="noopener" title="In Google Maps öffnen" className="text-s112-blue-700 hover:opacity-75"><MapPin size={14} strokeWidth={1.75} /></a>
                        : <Link href={`/weingarten/${r.id}`} title="Koordinaten setzen" className="text-s112-tertiary hover:text-s112-blue-700"><MapPin size={14} strokeWidth={1.25} /></Link>}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {wg.rieden.length > 12 && <p className="text-[11.5px] text-s112-tertiary mt-2">… und {wg.rieden.length - 12} weitere</p>}
            </div>
          )}
          <Note className="mt-3"><b>AMA-MFA-Import:</b> Feldstücksliste als PDF → KI-Extraktion → Prüfung → Import (in Analyse, siehe Projektordner). Bis dahin über <Link href="/admin/import" className="underline">Datenimport</Link> bzw. je Ried pflegen.</Note>
        </Card>

        <div className="space-y-5">
          <Card title={`Lesevorbereitung ${jahr}`}>
            <LeseCheckliste listeId={liste?.id ?? null} jahr={jahr} punkte={punkte} darfSchreiben={canWrite(ctx.role, 'rieden')} />
            <Note className="mt-3">Die Checkliste startet aus einer Vorlage – abhaken statt Zettel suchen. Punkte lassen sich je Betrieb ergänzen.</Note>
          </Card>

          {wg.wartefristen.length > 0 && (
            <Card title="Laufende Wartefristen" right={<Link href="/behandlungen" className="text-[11.5px] text-s112-blue-700 hover:underline">Maßnahmen →</Link>}>
              <div className="overflow-x-auto"><table className="w-full">
                <thead><tr><Th>Ried</Th><Th>Behandlung</Th><Th right>Lese frei ab</Th></tr></thead>
                <tbody>
                  {wg.wartefristen.slice(0, 6).map(w => (
                    <tr key={w.id}>
                      <Td className="font-semibold">{w.ried}</Td>
                      <Td mono>{fmtDate(w.datum)}</Td>
                      <Td right><Badge tone="warn">{fmtDate(w.freiAb)}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

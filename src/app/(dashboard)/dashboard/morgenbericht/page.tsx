import type { Metadata } from 'next'
import { geladen } from '@/lib/supabase/geladen'
import Link from '@/components/ui/Link'
import { redirect } from 'next/navigation'
import { canWrite } from '@/lib/auth/roles'
import { DashHeader, Card, Badge, Note, Th, Td } from '../_shared/ui'
import { getCtx, ladeEinstellungen } from '../_shared/data'
import { ladeMorgenbericht, wetterErlaubt } from '@/lib/morgenbericht/erstellen'
import type { Befund } from '@/lib/wetter/regeln'
import MorgenberichtKarte, { BefundZeile, WetterStreifen, zeitText } from './MorgenberichtKarte'
import AktualisierenKnopf from './AktualisierenKnopf'

export const metadata: Metadata = { title: 'Morgenbericht' }
export const dynamic = 'force-dynamic'

// ── Sicht "Morgenbericht" – /dashboard/morgenbericht (Jour fixe 9.9.2026) ────
// Vollständiger Tagesbericht: alle Befunde nach Stufe, Wetter & Rieden
// (Regen seit Behandlung, Schutzstatus, Wartezeit), Spritzfenster. Der Bericht
// selbst wird um 05:00 UTC vom Cron erstellt (api/cron/morgenbericht) oder mit
// „Jetzt aktualisieren“ manuell.

const SCHUTZ: Record<string, { label: string; tone: 'ok' | 'warn' | 'err' | 'info' | 'gray' }> = {
  ok: { label: 'Schutz gegeben', tone: 'ok' }, nachlassend: { label: 'nachlassend', tone: 'warn' }, abgewaschen: { label: 'abgewaschen', tone: 'err' },
  intervall: { label: 'Intervall abgelaufen', tone: 'warn' }, keine: { label: 'keine Behandlung', tone: 'gray' }, unbekannt: { label: 'ohne Koordinaten', tone: 'gray' },
}
const datumDe = (iso: string | null) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' }) : '–'

export default async function MorgenberichtPage() {
  const ctx = await getCtx()
  if (!ctx.tenantId) redirect('/login')
  const einst = await ladeEinstellungen(ctx)
  const [bericht, tenantRes] = await Promise.all([
    ladeMorgenbericht(ctx.supabase, ctx.tenantId),
    // tenant-isolation-ignore: tenants hat keine tenant_id-Spalte, Filter über die eigene id
    ctx.q('tenants').select('stripe_plan').eq('id', ctx.tenantId).maybeSingle(),
  ])
  const tenant = geladen(tenantRes, 'Betrieb')
  const darfSchreiben = canWrite(ctx.role, 'betrieb')
  const we = wetterErlaubt(einst, (tenant as { stripe_plan?: string | null } | null)?.stripe_plan)
  const gruppen: { stufe: Befund['stufe']; titel: string }[] = [{ stufe: 'hoch', titel: 'Dringend' }, { stufe: 'mittel', titel: 'Zu erledigen' }, { stufe: 'info', titel: 'Hinweise' }]

  return (
    <div className="space-y-6">
      <DashHeader
        title="Morgenbericht"
        sub={<>Täglicher Scan des Betriebs um 7 Uhr: Fristen, Gärkontrollen, Zahlungsziele, Belege, Bestände, Wartefristen, Kontakte, Abo – und das Wetter an den Rieden, verknüpft mit den Behandlungen. Prüfungen sind deterministisch, die KI fasst nur zusammen.</>}
        right={<div className="flex items-center gap-2">{bericht && <span className="text-[11.5px] text-s112-tertiary font-mono">erstellt {zeitText(bericht.erstelltAm)}{bericht.ausloeser === 'manuell' ? ' (manuell)' : ''}</span>}{darfSchreiben && <AktualisierenKnopf />}</div>}
      />

      {!bericht ? (
        <MorgenberichtKarte bericht={null} darfSchreiben={darfSchreiben} wetterHinweis={we.erlaubt ? null : `Wetter & Empfehlungen: ${we.grund}.`} />
      ) : (
        <>
          <Card title={`Zusammenfassung · ${new Date(bericht.datum + 'T00:00:00').toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
            right={<div className="flex items-center gap-2">{bericht.anzahl.hoch > 0 && <Badge tone="err">{bericht.anzahl.hoch} dringend</Badge>}{bericht.anzahl.mittel > 0 && <Badge tone="warn">{bericht.anzahl.mittel} zu erledigen</Badge>}{bericht.anzahl.info > 0 && <Badge tone="info">{bericht.anzahl.info} Hinweise</Badge>}{bericht.befunde.length === 0 && <Badge tone="ok">keine Befunde</Badge>}</div>}>
            <p className="text-[14px] text-s112-text leading-relaxed max-w-[80ch]">{bericht.zusammenfassung}</p>
            {bericht.kiModell ? <p className="mt-2 text-[11px] text-s112-tertiary">Zusammenfassung mit KI ({bericht.kiModell}) aus den geprüften Befunden – zählt als eine Abfrage im KI-Kontingent.</p> : <p className="mt-2 text-[11px] text-s112-tertiary">Ohne KI-Zusammenfassung (Kontingent, Schlüssel, KI-Modul, Zeitgrenze oder Fehler beim Aufruf) – die Befunde unten gelten unverändert.</p>}
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {gruppen.map(g => {
              const liste = bericht.befunde.filter(b => b.stufe === g.stufe)
              return (
                <Card key={g.stufe} title={`${g.titel} (${liste.length})`}>
                  {liste.length === 0 ? <p className="text-[13px] text-s112-tertiary">nichts</p> : <ul>{liste.map(b => <BefundZeile key={b.key} b={b} />)}</ul>}
                </Card>
              )
            })}
          </div>

          <Card title="Wetter & Rieden" right={bericht.wetter?.erlaubt && bericht.wetter.punkte > 0 ? <a href="https://warndienst.at" target="_blank" rel="noopener" className="text-[11.5px] text-s112-blue-700 hover:underline">Warndienst (LK) →</a> : undefined}>
            {bericht.wetter ? <WetterStreifen w={bericht.wetter} kompakt={false} /> : <Note>Keine Wetterdaten im Bericht.</Note>}
            {bericht.wetter?.erlaubt && bericht.wetter.punkte > 0 && (
              <>
                {bericht.wetter.spritzfenster.length > 0 && (
                  <p className="mt-3 text-[13px] text-s112-text"><span className="text-s112-text-2">Spritzfenster (Wind ≤ 15 km/h, kein Regen, 5–20 Uhr):</span> {bericht.wetter.spritzfenster.map(f => f.label).join(' · ')}</p>
                )}
                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-sm min-w-[720px]">
                    <thead><tr><Th>Ried</Th><Th>Letzte Spritzung</Th><Th>Mittel</Th><Th right>Tage</Th><Th right>Regen seither</Th><Th>Schutz</Th><Th>Wartezeit bis</Th></tr></thead>
                    <tbody>
                      {bericht.wetter.rieden.map(r => (
                        <tr key={r.id}>
                          <Td className="font-medium"><Link href={`/weingarten/${r.id}`} className="hover:text-s112-blue-700">{r.ried || r.name}</Link>{r.ried && r.ried !== r.name && <span className="block text-[11px] text-s112-tertiary font-normal">{r.name}</span>}</Td>
                          <Td mono className="text-s112-text-2">{datumDe(r.letzteBehandlung)}</Td>
                          <Td className="text-s112-text-2">{r.mittel ?? '–'}</Td>
                          <Td right mono className="text-s112-text-2">{r.tageSeit ?? '–'}</Td>
                          <Td right mono>{r.regenSeit === null ? '–' : `${r.regenSeit.toLocaleString('de-DE', { maximumFractionDigits: 1 })} mm`}</Td>
                          <Td><Badge tone={SCHUTZ[r.schutz]?.tone ?? 'gray'}>{SCHUTZ[r.schutz]?.label ?? r.schutz}</Badge></Td>
                          <Td mono className="text-s112-text-2">{datumDe(r.wartezeitBis)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(bericht.wetter.ohneKoordinaten ?? 0) > 0 && <p className="mt-2 text-[12px] text-s112-tertiary">{bericht.wetter.ohneKoordinaten} Rieden ohne Koordinaten – unter Rieden die Lage setzen, dann werden sie ausgewertet.</p>}
                <Note className="mt-4">
                  Regeln: Belag gilt ab {einst.wetterAbwaschMm} mm Regen seit der Behandlung als abgewaschen (ab {Math.round(einst.wetterAbwaschMm * 0.6)} mm nachlassend), Spritzintervall {einst.wetterIntervallTage} Tage (Mai–August). Frost, Hitze, Sturm und Regen vor der Lese aus der Prognose (48 h). Infektionsmodelle liefert der Warndienst der Landwirtschaftskammern – hier nur die Verknüpfung mit den eigenen Behandlungen, keine Pflanzenschutzberatung. Wetterdaten: GeoSphere Austria, INCA-Analyse 1 km und AROME-Prognose 2,5 km (CC BY 4.0).
                </Note>
              </>
            )}
          </Card>
        </>
      )}
      <p className="text-[11.5px] text-s112-tertiary">Schwellwerte und Ein/Aus unter <Link href="/betrieb/einstellungen" className="text-s112-blue-700 hover:underline">Mein Betrieb → Branding & Regeln</Link>.</p>
    </div>
  )
}

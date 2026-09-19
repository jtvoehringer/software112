import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { redirect } from 'next/navigation'
import { Landmark, Printer, Plus } from 'lucide-react'
import { canWrite } from '@/lib/auth/roles'
import { fmtEur, fmtNum } from '@/lib/format'
import { afaBuchungsStatus, afaImJahr, afaSatzProzent, anlagenspiegel, buchwertEndeJahr } from '@/lib/ea/anlagen'
import { DashHeader, Tile, Card, Badge, Note, Empty, Th, Td, fmtDate } from '@/app/(dashboard)/dashboard/_shared/ui'
import { getCtx, ladeEinstellungen, type R } from '@/app/(dashboard)/dashboard/_shared/data'
import JahrWaehler from './JahrWaehler'
import AfaBuchen from './AfaBuchen'
import { ladeAnlagen, ladeAfaBuchungen, ladeKandidaten, anlagenJahre, kontoText } from './daten'

export const metadata: Metadata = { title: 'Anlagen & AfA – software:112' }
export const dynamic = 'force-dynamic'

// ── Anlagenverzeichnis – /buchhaltung/anlagen (Migration 200) ─────────────────
// Liste aller Anlagen mit AfA des gewählten Jahres und Buchwert zum Jahresende,
// darüber die Summen (Anlagenspiegel), darunter die AfA-Buchung des Jahres.

const METHODE: Record<string, string> = { linear: 'linear', degressiv: 'degressiv', gwg: 'GWG' }

export default async function AnlagenPage({ searchParams }: { searchParams: Promise<{ jahr?: string }> }) {
  const ctx = await getCtx()
  if (!ctx.tenantId) redirect('/login')
  const einst = await ladeEinstellungen(ctx)
  if (!einst.modulEa) redirect('/dashboard')

  const anlagen = await ladeAnlagen(ctx)
  const aktJahr = ctx.heute.getFullYear()
  const { jahr: jahrParam } = await searchParams
  const jahre = anlagenJahre(anlagen, aktJahr)
  const jahr = jahre.includes(Number(jahrParam)) ? Number(jahrParam) : aktJahr

  const [afaBuchungen, offeneKaeufe, { data: dezRaw }] = await Promise.all([
    ladeAfaBuchungen(ctx, jahr),
    ladeKandidaten(ctx),
    ctx.tf(ctx.q('ea_monatsabschluss').select('id').eq('jahr', jahr).eq('monat', 12).limit(1).maybeSingle()),
  ])
  const spiegel = anlagenspiegel(anlagen, jahr)
  const afaStatus = afaBuchungsStatus(anlagen, jahr, afaBuchungen)
  const dezemberGesperrt = !!(dezRaw as R | null)?.id
  const darfSchreiben = canWrite(ctx.role, 'ea')

  const zeilen = anlagen
    .filter(a => Number(a.anschaffung_am.slice(0, 4)) <= jahr)
    .map(a => ({ a, afa: afaImJahr(a, jahr), buchwert: buchwertEndeJahr(a, jahr), abgegangen: !!a.abgang_am && Number(a.abgang_am.slice(0, 4)) <= jahr }))

  return (
    <div className="space-y-6">
      <DashHeader
        title="Anlagen & AfA"
        sub={<>Abnutzbares Anlagevermögen mit Nutzungsdauer, Abschreibung je Jahr und Buchwert · § 7 und § 13 EStG. {einst.doppik ? 'Bei doppelter Buchhaltung beim Steuerberater dient das Verzeichnis als Beilage (Anlagenspiegel).' : 'Die Jahres-AfA wird als Betriebsausgabe gebucht.'}</>}
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <JahrWaehler jahre={jahre} jahr={jahr} />
            {anlagen.length > 0 && (
              <Link href={`/buchhaltung/anlagen/spiegel?jahr=${jahr}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium text-s112-blue-700 border border-s112-line-str bg-white hover:bg-s112-bg">
                <Printer size={14} strokeWidth={1.75} />Anlagenspiegel
              </Link>
            )}
            {darfSchreiben && (
              <Link href="/buchhaltung/anlagen/neu" className="inline-flex items-center gap-1.5 bg-s112-teal text-s112-yellow px-3.5 py-1.5 rounded-lg text-[13px] font-semibold hover:bg-s112-blue-700">
                <Plus size={14} strokeWidth={2.5} />Anlage erfassen
              </Link>
            )}
          </div>
        }
      />
      <p className="text-[11.5px] text-s112-tertiary -mt-3">
        <Link href="/buchhaltung" className="hover:text-s112-blue-700">{einst.doppik ? 'Belege & BMD' : 'E&A-Rechnung'}</Link> · Anlagen & AfA
      </p>

      {offeneKaeufe.length > 0 && (
        <Card title={`${offeneKaeufe.length} ${offeneKaeufe.length === 1 ? 'Anlagenkauf' : 'Anlagenkäufe'} ohne Eintrag im Verzeichnis`} right={<Badge tone="warn">zu erfassen</Badge>}>
          <ul className="divide-y divide-s112-line">
            {offeneKaeufe.slice(0, 6).map(b => (
              <li key={b.id} className="flex items-center gap-3 py-2">
                <span className="font-mono text-[12.5px] text-s112-text-2 shrink-0 tabular-nums">{fmtDate(b.datum)}</span>
                <span className="flex-1 min-w-0 truncate text-[13px] text-s112-text">{b.beschreibung || b.kategorie}</span>
                <span className="font-mono text-[13px] font-semibold text-s112-text shrink-0 tabular-nums">{fmtEur(b.betrag_netto)}</span>
                {darfSchreiben && <Link href={`/buchhaltung/anlagen/neu?buchung=${b.id}`} className="text-[12.5px] text-s112-blue-700 hover:underline shrink-0">Anlage anlegen →</Link>}
              </li>
            ))}
          </ul>
          {offeneKaeufe.length > 6 && <p className="text-[12px] text-s112-tertiary mt-2">+ {offeneKaeufe.length - 6} weitere</p>}
        </Card>
      )}

      {anlagen.length === 0 ? (
        <Card>
          <Empty action={darfSchreiben ? { href: '/buchhaltung/anlagen/neu', label: 'Erste Anlage erfassen' } : undefined}>
            <Landmark size={22} strokeWidth={1.5} className="inline-block text-s112-tertiary mb-2" /><br />
            Noch keine Anlage erfasst. Anschaffungen über 1.000 € netto (Traktor, Presse, Tanks, Fässer, Fahrzeuge, Gebäude …) gehören ins Anlagenverzeichnis und werden über die Nutzungsdauer abgeschrieben.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <Tile label={`Anschaffungskosten (Bestand ${jahr})`} icon={Landmark} value={fmtEur(spiegel.anschaffungskosten)} sub={`${spiegel.anzahlAktiv} ${spiegel.anzahlAktiv === 1 ? 'Anlage' : 'Anlagen'}`} />
            <Tile label={`AfA ${jahr}`} value={fmtEur(spiegel.afaJahr)} sub="Abschreibung des Jahres" />
            <Tile label="Kumulierte AfA" value={fmtEur(spiegel.kumulierteAfa)} sub={`bis 31.12.${jahr}`} />
            <Tile label={`Buchwert 31.12.${jahr}`} value={fmtEur(spiegel.buchwertEnde)} sub={spiegel.zugaenge > 0 ? `Zugänge ${fmtEur(spiegel.zugaenge)}` : spiegel.abgaenge > 0 ? `Abgänge ${fmtEur(spiegel.abgaenge)}` : 'keine Zu-/Abgänge'} />
          </div>

          <Card title={`Anlagen ${jahr}`} right={<span className="font-mono text-[11px] text-s112-tertiary">{zeilen.length} {zeilen.length === 1 ? 'Eintrag' : 'Einträge'}</span>} pad={false}>
            <div className="overflow-x-auto px-[18px] pb-2">
              <table className="w-full min-w-[860px] text-sm">
                <thead><tr>
                  <Th>Anlage</Th><Th>Konto</Th><Th>Anschaffung</Th><Th right>AK netto</Th><Th right>ND</Th><Th>Methode</Th><Th right>AfA {jahr}</Th><Th right>Buchwert 31.12.</Th><Th>Status</Th>
                </tr></thead>
                <tbody>
                  {zeilen.map(({ a, afa, buchwert, abgegangen }) => (
                    <tr key={a.id} className={abgegangen ? 'opacity-60' : ''}>
                      <Td className="font-medium text-s112-text">
                        <Link href={`/buchhaltung/anlagen/${a.id}`} className="hover:text-s112-blue-700">{a.name}</Link>
                        {a.gruppe && <span className="block text-[11.5px] text-s112-tertiary font-normal">{a.gruppe}</span>}
                      </Td>
                      <Td mono className="text-s112-text-2">{kontoText(a.konto_nr)}</Td>
                      <Td mono className="text-s112-text-2">{fmtDate(a.anschaffung_am)}</Td>
                      <Td right mono>{fmtEur(a.ak_netto)}</Td>
                      <Td right mono className="text-s112-text-2">{a.methode === 'gwg' ? '–' : `${a.nutzungsdauer_jahre} J.`}</Td>
                      <Td className="text-s112-text-2">{METHODE[a.methode]} <span className="font-mono text-[11.5px] text-s112-tertiary">{fmtNum(afaSatzProzent(a), { max: 2 })} %</span></Td>
                      <Td right mono className="text-s112-text-2">{afa > 0 ? fmtEur(afa) : '–'}</Td>
                      <Td right mono className="font-semibold text-s112-text">{fmtEur(buchwert)}</Td>
                      <Td>{abgegangen
                        ? <Badge tone="gray">Abgang {fmtDate(a.abgang_am)}</Badge>
                        : buchwert <= a.restwert ? <Badge tone="info">abgeschrieben</Badge>
                        : <Badge tone="ok">aktiv</Badge>}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <AfaBuchen status={afaStatus} dezemberGesperrt={dezemberGesperrt} laufend={jahr >= aktJahr} doppik={einst.doppik} darfSchreiben={darfSchreiben} />

          <Note>
            Halbjahresregel: bei Inbetriebnahme im zweiten Halbjahr im ersten Jahr nur die halbe Jahres-AfA. Geringwertige Wirtschaftsgüter
            (bis 1.000 € netto) werden im Jahr der Anschaffung voll abgeschrieben. Die Anschaffung selbst bleibt als Buchung in der
            Kategorie „Anlagenkauf (aktivierungspflichtig)“ erfasst – so stimmen Vorsteuer und BMD-Übergabe; in der Finanzübersicht wird
            sie beim steuerlichen Ergebnis herausgerechnet und durch die AfA ersetzt.
          </Note>
        </>
      )}
    </div>
  )
}

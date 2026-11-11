// Serverseitige PDF-Erzeugung der Verkaufsrechnung (für E-Mail-Anhang und
// spätere Download-Funktion). Nutzt @react-pdf/renderer statt eines Headless-
// Browsers – läuft ohne zusätzliche Binärdateien in Vercel Serverless
// Functions. Layout ist bewusst dem bestehenden HTML-Druck-Layout in
// src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx nachempfunden, damit
// PDF und Bildschirm-/Druckansicht optisch übereinstimmen.
// KAN-379: mit `storno` als Stornorechnung (Titel, „zu Rechnung … vom …“, Grund, negative Beträge, ohne Zahlungsteil).
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

function fmt(n: number) {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) // CD: Tausenderpunkt
}
function fmtEur(n: number) {
  return `€ ${fmt(n)}` // CD-Manual: €-Zeichen vorne
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#222' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  senderName: { fontSize: 13, fontWeight: 700, marginBottom: 2 },
  senderDetail: { fontSize: 9, color: '#555' },
  metaBlock: { alignItems: 'flex-end' },
  title: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
  nr: { fontSize: 10.5, fontWeight: 700, marginBottom: 4 },
  metaText: { fontSize: 9, color: '#555' },
  recipientBlock: { marginBottom: 24, padding: 10, borderWidth: 1, borderColor: '#EDEEF1', alignSelf: 'flex-start', minWidth: 200 },
  rname: { fontSize: 10.5, fontWeight: 700 },
  rdetail: { fontSize: 9, color: '#555' },
  tableHead: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: '#2F63AC', paddingBottom: 4, marginBottom: 4 },
  th: { fontSize: 8, color: '#666', textTransform: 'uppercase' },
  posRow: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#EDEEF1' },
  posName: { flex: 1, paddingRight: 6 },
  posTitle: { fontSize: 9.5, fontWeight: 700 },
  posSub: { fontSize: 8, color: '#888', marginTop: 1 },
  abschnittRow: { paddingTop: 6, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: '#EDEEF1', backgroundColor: '#F7F8FA' },
  abschnittText: { fontSize: 8, fontWeight: 700, color: '#555' },
  qty: { width: 55, fontSize: 9, textAlign: 'right' },
  unit: { width: 45, fontSize: 9, color: '#777' },
  unitPrice: { width: 65, fontSize: 9, textAlign: 'right' },
  rabatt: { width: 45, fontSize: 9, textAlign: 'right', color: '#888' },
  amount: { width: 75, fontSize: 9.5, fontWeight: 700, textAlign: 'right' },
  totalsRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 8 },
  totalsLabel: { fontSize: 10, fontWeight: 700, color: '#333', marginRight: 12 },
  totalsAmount: { width: 75, fontSize: 12, fontWeight: 700, textAlign: 'right' },
  ustBlock: { alignSelf: 'flex-end', width: 220, marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#eee' },
  ustRow: { flexDirection: 'row', justifyContent: 'space-between', fontSize: 8.5, color: '#777', paddingVertical: 1 },
  ustTotal: { flexDirection: 'row', justifyContent: 'space-between', fontSize: 9.5, fontWeight: 700, color: '#333', marginTop: 3, paddingTop: 3, borderTopWidth: 1, borderTopColor: '#eee' },
  skonto: { marginTop: 16, padding: 8, backgroundColor: '#FBF3E3', fontSize: 9, color: '#8A6415' },
  payment: { marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#EDEEF1' },
  paymentH: { fontSize: 8.5, fontWeight: 700, color: '#444', textTransform: 'uppercase', marginBottom: 4 },
  paymentP: { fontSize: 9, color: '#555', marginTop: 2 },
  notes: { fontSize: 9, color: '#666', fontStyle: 'italic', marginTop: 16 },
  rechnungstext: { fontSize: 9.5, color: '#222', marginTop: 12, lineHeight: 1.4 },
  footer: {
    position: 'absolute', bottom: 30, left: 40, right: 40, fontSize: 7.5, color: '#aaa',
    textAlign: 'center', borderTopWidth: 1, borderTopColor: '#EDEEF1', paddingTop: 8,
  },
})

export type VerkaufRechnungPosition = {
  /** KAN-105: Sammelrechnung – Zwischenzeile vor der ersten Position eines Lieferscheins („Lieferschein LS-… vom …“) */
  abschnitt?: string | null
  name: string
  sub: string | null
  menge: number
  einheit: string
  preisBrutto: number | null
  rabattPct: number
  summe: number | null
}

export type VerkaufRechnungPdfProps = {
  betrieb: {
    name: string
    strasse: string | null
    plzOrt: string | null
    telefon: string | null
    email: string | null
    website: string | null
    uid: string | null
    logoUrl: string | null
  }
  rechnung: {
    nummer: string | null
    datumIso: string
    faelligkeitIso: string
    /** KAN-105: Lieferzeitraum der Sammelrechnung (Text), sonst leer */
    lieferzeitraum?: string | null
  }
  kunde: {
    name: string
    zHande: string | null
    strasse: string | null
    plzOrt: string | null
  }
  /** KAN-176: abweichende Lieferadresse (Zeilen), leer = Rechnungsadresse */
  lieferadresse?: string[]
  positionen: VerkaufRechnungPosition[]
  gesamt: number
  gesamtNetto: number
  ustGruppen: Record<string, number> // Steuersatz (%) -> Nettobetrag dieser Gruppe
  skonto: { pct: number; datumIso: string; betrag: number } | null
  bank: { iban: string | null; bic: string | null; zahlungszielTage: number; faelligkeitIso: string }
  fusstext: string | null
  /** KAN-416: Texte auf Rechnung der Lieferscheine (rechnungstexteFuerBeleg) – unter den Positionen, vor dem Fußtext */
  rechnungstexte?: string[]
  /** KAN-379: Stornobeleg – Bezug auf die Rechnung und Grund; Beträge kommen negativ (stornobelegPdfInhalt) */
  storno?: { zuNummer: string; zuDatumIso: string; grund: string | null } | null
}

export function VerkaufRechnungDocument(props: VerkaufRechnungPdfProps) {
  const { betrieb, rechnung, kunde, lieferadresse, positionen, gesamt, gesamtNetto, ustGruppen, bank, fusstext } = props
  const storno = props.storno ?? null
  const skonto = storno ? null : props.skonto
  const color = '#2F63AC'
  // react-pdf's <Image> unterstützt zuverlässig nur Raster-Formate (PNG/JPG).
  // SVG-Logos (z. B. das App-Platzhalter-Logo mit eingebettetem <text>) lassen
  // sich damit nicht sicher einbetten – react-pdf versucht dabei intern eine
  // Font-Auflösung für im SVG enthaltenen Text und scheitert an nicht
  // registrierten Web-Fonts ("Font family not registered: Arial, Helvetica,
  // sans-serif"). Für SVG-URLs daher auf den Textnamen zurückfallen, wie auch
  // ganz ohne Logo.
  const logoIstRasterbild = !!betrieb.logoUrl && !/\.svg(\?|$)/i.test(betrieb.logoUrl)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            {logoIstRasterbild ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={betrieb.logoUrl!} style={{ width: 120, height: 50, objectFit: 'contain', marginBottom: 6 }} />
            ) : (
              <Text style={styles.senderName}>{betrieb.name}</Text>
            )}
            {betrieb.strasse && <Text style={styles.senderDetail}>{betrieb.strasse}</Text>}
            {betrieb.plzOrt && <Text style={styles.senderDetail}>{betrieb.plzOrt}</Text>}
            {betrieb.telefon && <Text style={styles.senderDetail}>Tel: {betrieb.telefon}</Text>}
            {betrieb.email && <Text style={styles.senderDetail}>{betrieb.email}</Text>}
            {betrieb.website && <Text style={styles.senderDetail}>{betrieb.website}</Text>}
            {betrieb.uid && <Text style={[styles.senderDetail, { marginTop: 4, color: '#999' }]}>UID: {betrieb.uid}</Text>}
          </View>
          <View style={styles.metaBlock}>
            <Text style={[styles.title, { color }]}>{storno ? 'STORNORECHNUNG' : 'RECHNUNG'}</Text>
            {rechnung.nummer && <Text style={styles.nr}>Nr. {rechnung.nummer}</Text>}
            <Text style={styles.metaText}>Datum: {fmtDate(rechnung.datumIso)}</Text>
            {storno && <Text style={styles.metaText}>zu Rechnung {storno.zuNummer} vom {fmtDate(storno.zuDatumIso)}</Text>}
            {rechnung.lieferzeitraum && <Text style={styles.metaText}>Lieferzeitraum: {rechnung.lieferzeitraum}</Text>}
            {!storno && (
              <Text style={styles.metaText}>
                {bank.zahlungszielTage === 0 ? 'Zahlbar bei Erhalt' : `Zahlbar bis: ${fmtDate(rechnung.faelligkeitIso)}`}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.recipientBlock}>
          <Text style={styles.rname}>{kunde.name}</Text>
          {kunde.zHande && <Text style={styles.rdetail}>z.H. {kunde.zHande}</Text>}
          {kunde.strasse && <Text style={styles.rdetail}>{kunde.strasse}</Text>}
          {kunde.plzOrt && <Text style={styles.rdetail}>{kunde.plzOrt}</Text>}
          {lieferadresse && lieferadresse.length > 0 && (
            <>
              <Text style={[styles.rdetail, { marginTop: 6 }]}>Lieferadresse:</Text>
              {lieferadresse.map((z, i) => <Text key={i} style={styles.rdetail}>{z}</Text>)}
            </>
          )}
        </View>

        <View style={styles.tableHead}>
          <Text style={[styles.th, { flex: 1 }]}>Bezeichnung</Text>
          <Text style={[styles.th, { width: 55, textAlign: 'right' }]}>Menge</Text>
          <Text style={[styles.th, { width: 45 }]}>Einh.</Text>
          <Text style={[styles.th, { width: 65, textAlign: 'right' }]}>Preis/Einh.</Text>
          <Text style={[styles.th, { width: 45, textAlign: 'right' }]}>Rabatt</Text>
          <Text style={[styles.th, { width: 75, textAlign: 'right' }]}>Summe</Text>
        </View>

        {positionen.map((pos, i) => (
          <View key={i}>
          {pos.abschnitt && pos.abschnitt !== positionen[i - 1]?.abschnitt && (
            <View style={styles.abschnittRow}><Text style={styles.abschnittText}>{pos.abschnitt}</Text></View>
          )}
          <View style={styles.posRow}>
            <View style={styles.posName}>
              <Text style={styles.posTitle}>{pos.name}</Text>
              {pos.sub && <Text style={styles.posSub}>{pos.sub}</Text>}
            </View>
            <Text style={styles.qty}>{fmt(pos.menge)}</Text>
            <Text style={styles.unit}>{pos.einheit}</Text>
            <Text style={styles.unitPrice}>{pos.preisBrutto != null ? fmt(pos.preisBrutto) : '–'}</Text>
            <Text style={styles.rabatt}>{pos.rabattPct > 0 ? `${pos.rabattPct}%` : '–'}</Text>
            <Text style={styles.amount}>{pos.summe != null ? fmt(pos.summe) : '–'}</Text>
          </View>
          </View>
        ))}

        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>{storno ? 'Stornobetrag brutto' : 'Gesamt brutto'}</Text>
          <Text style={[styles.totalsAmount, { color }]}>{fmt(gesamt)}</Text>
        </View>

        <View style={styles.ustBlock}>
          <View style={styles.ustRow}><Text>Nettobetrag</Text><Text>{fmtEur(gesamtNetto)}</Text></View>
          {Object.entries(ustGruppen).map(([satz, netto]) => (
            <View key={satz} style={styles.ustRow}>
              <Text>MwSt {satz}%</Text>
              <Text>{fmtEur((netto * Number(satz)) / 100)}</Text>
            </View>
          ))}
          <View style={styles.ustTotal}>
            <Text>{storno ? 'Stornobetrag' : 'Rechnungsbetrag'}</Text><Text>{fmtEur(gesamt)}</Text>
          </View>
        </View>

        {skonto && (
          <Text style={styles.skonto}>
            {skonto.pct}% Skonto bei Zahlung bis {fmtDate(skonto.datumIso)} – Zahlbetrag bei fristgerechter Zahlung:
            {' '}{fmtEur(gesamt - skonto.betrag)} (−{fmtEur(skonto.betrag)} Skonto)
          </Text>
        )}

        {storno ? (
          <View style={styles.payment}>
            <Text style={styles.paymentH}>Storno</Text>
            <Text style={styles.paymentP}>
              Diese Stornorechnung hebt die Rechnung {storno.zuNummer} vom {fmtDate(storno.zuDatumIso)} vollständig auf.
            </Text>
            {storno.grund && <Text style={styles.paymentP}>Grund: {storno.grund}</Text>}
          </View>
        ) : (
        <View style={styles.payment}>
          <Text style={styles.paymentH}>Zahlungskonditionen</Text>
          <Text style={styles.paymentP}>
            {bank.zahlungszielTage === 0
              ? 'Zahlbar bei Erhalt (ohne Abzug)'
              : `Innerhalb von ${bank.zahlungszielTage} Tagen netto (${fmtDate(bank.faelligkeitIso)})`}
          </Text>
          {(bank.iban || bank.bic) && (
            <Text style={styles.paymentP}>
              {bank.iban ? `IBAN: ${bank.iban}` : ''}{bank.bic ? ` · BIC: ${bank.bic}` : ''}
            </Text>
          )}
          {rechnung.nummer && <Text style={styles.paymentP}>Verwendungszweck: {rechnung.nummer}</Text>}
        </View>
        )}

        {(props.rechnungstexte ?? []).map((t, i) => <Text key={i} style={styles.rechnungstext}>{t}</Text>)}

        {fusstext && <Text style={styles.notes}>{fusstext}</Text>}

        <Text style={styles.footer}>{betrieb.name}{betrieb.uid ? ` · UID: ${betrieb.uid}` : ''}</Text>
      </Page>
    </Document>
  )
}

export async function renderVerkaufRechnungPdf(props: VerkaufRechnungPdfProps): Promise<Buffer> {
  return renderToBuffer(<VerkaufRechnungDocument {...props} />)
}

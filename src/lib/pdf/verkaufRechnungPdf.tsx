// Serverseitige PDF-Erzeugung der Verkaufsrechnung (für E-Mail-Anhang und
// spätere Download-Funktion). Nutzt @react-pdf/renderer statt eines Headless-
// Browsers – läuft ohne zusätzliche Binärdateien in Vercel Serverless
// Functions. Layout ist bewusst dem bestehenden HTML-Druck-Layout in
// src/app/(dashboard)/weinhandel/verkauf/[id]/page.tsx nachempfunden, damit
// PDF und Bildschirm-/Druckansicht optisch übereinstimmen.
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

function fmt(n: number) {
  return new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
function fmtEur(n: number) {
  return `${fmt(n)} €`
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('de-AT')
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
  recipientBlock: { marginBottom: 24, padding: 10, borderWidth: 1, borderColor: '#e5e5e5', alignSelf: 'flex-start', minWidth: 200 },
  rname: { fontSize: 10.5, fontWeight: 700 },
  rdetail: { fontSize: 9, color: '#555' },
  tableHead: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: '#35609E', paddingBottom: 4, marginBottom: 4 },
  th: { fontSize: 8, color: '#666', textTransform: 'uppercase' },
  posRow: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f2f2f2' },
  posName: { flex: 1, paddingRight: 6 },
  posTitle: { fontSize: 9.5, fontWeight: 700 },
  posSub: { fontSize: 8, color: '#888', marginTop: 1 },
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
  skonto: { marginTop: 16, padding: 8, backgroundColor: '#fef3e0', fontSize: 9, color: '#92620a' },
  payment: { marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#eeeeee' },
  paymentH: { fontSize: 8.5, fontWeight: 700, color: '#444', textTransform: 'uppercase', marginBottom: 4 },
  paymentP: { fontSize: 9, color: '#555', marginTop: 2 },
  notes: { fontSize: 9, color: '#666', fontStyle: 'italic', marginTop: 16 },
  footer: {
    position: 'absolute', bottom: 30, left: 40, right: 40, fontSize: 7.5, color: '#aaa',
    textAlign: 'center', borderTopWidth: 1, borderTopColor: '#eeeeee', paddingTop: 8,
  },
})

export type VerkaufRechnungPosition = {
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
  }
  kunde: {
    name: string
    zHande: string | null
    strasse: string | null
    plzOrt: string | null
  }
  positionen: VerkaufRechnungPosition[]
  gesamt: number
  gesamtNetto: number
  ustGruppen: Record<string, number> // Steuersatz (%) -> Nettobetrag dieser Gruppe
  skonto: { pct: number; datumIso: string; betrag: number } | null
  bank: { iban: string | null; bic: string | null; zahlungszielTage: number; faelligkeitIso: string }
  fusstext: string | null
}

export function VerkaufRechnungDocument(props: VerkaufRechnungPdfProps) {
  const { betrieb, rechnung, kunde, positionen, gesamt, gesamtNetto, ustGruppen, skonto, bank, fusstext } = props
  const color = '#35609E'

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            {betrieb.logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={betrieb.logoUrl} style={{ width: 120, height: 50, objectFit: 'contain', marginBottom: 6 }} />
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
            <Text style={[styles.title, { color }]}>RECHNUNG</Text>
            {rechnung.nummer && <Text style={styles.nr}>Nr. {rechnung.nummer}</Text>}
            <Text style={styles.metaText}>Datum: {fmtDate(rechnung.datumIso)}</Text>
            <Text style={styles.metaText}>Zahlbar bis: {fmtDate(rechnung.faelligkeitIso)}</Text>
          </View>
        </View>

        <View style={styles.recipientBlock}>
          <Text style={styles.rname}>{kunde.name}</Text>
          {kunde.zHande && <Text style={styles.rdetail}>z.H. {kunde.zHande}</Text>}
          {kunde.strasse && <Text style={styles.rdetail}>{kunde.strasse}</Text>}
          {kunde.plzOrt && <Text style={styles.rdetail}>{kunde.plzOrt}</Text>}
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
          <View key={i} style={styles.posRow}>
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
        ))}

        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>Gesamt brutto</Text>
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
            <Text>Rechnungsbetrag</Text><Text>{fmtEur(gesamt)}</Text>
          </View>
        </View>

        {skonto && (
          <Text style={styles.skonto}>
            {skonto.pct}% Skonto bei Zahlung bis {fmtDate(skonto.datumIso)} – Zahlbetrag bei fristgerechter Zahlung:
            {' '}{fmtEur(gesamt - skonto.betrag)} (−{fmtEur(skonto.betrag)} Skonto)
          </Text>
        )}

        <View style={styles.payment}>
          <Text style={styles.paymentH}>Zahlungskonditionen</Text>
          <Text style={styles.paymentP}>
            Innerhalb von {bank.zahlungszielTage} Tagen netto ({fmtDate(bank.faelligkeitIso)})
          </Text>
          {(bank.iban || bank.bic) && (
            <Text style={styles.paymentP}>
              {bank.iban ? `IBAN: ${bank.iban}` : ''}{bank.bic ? ` · BIC: ${bank.bic}` : ''}
            </Text>
          )}
          {rechnung.nummer && <Text style={styles.paymentP}>Verwendungszweck: {rechnung.nummer}</Text>}
        </View>

        {fusstext && <Text style={styles.notes}>{fusstext}</Text>}

        <Text style={styles.footer}>{betrieb.name}{betrieb.uid ? ` · UID: ${betrieb.uid}` : ''}</Text>
      </Page>
    </Document>
  )
}

export async function renderVerkaufRechnungPdf(props: VerkaufRechnungPdfProps): Promise<Buffer> {
  return renderToBuffer(<VerkaufRechnungDocument {...props} />)
}

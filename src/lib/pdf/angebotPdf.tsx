// Angebot als PDF (KAN-418 Teil 4, 12.11.2026) – für Download und E-Mail-Anhang. Aufbau, Schrift und Kopf wie die
// Auftragsbestätigung (auftragsbestaetigungPdf.tsx), aber MIT Preisen: Bruttopreis je Flasche, Rabatt, Zeilenbetrag,
// Summe netto / USt. / brutto (Entscheidung Jörgen 12.11.2026, Frage 1A). Alle Beträge kommen fertig gerundet aus
// lib/auftrag/angebot.ts – hier wird nur formatiert.
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

export type AngebotPdfProps = {
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
  angebot: { nummer: string; datum: string; gueltigBis: string }
  kunde: { name: string; strasse: string | null; plzOrt: string | null }
  positionen: { name: string; sub: string | null; flaschen: number; preis: number; rabatt: string; betrag: number }[]
  summen: { brutto: number; netto: number; ust: { satz: number; netto: number; steuer: number }[]; flaschen: number }
  /** Sätze unter den Summen (Gültigkeit, freibleibend) */
  hinweise: string[]
}

const fmtZahl = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(n)
const fmtEur = (n: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n)
const fmtSatz = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(n)

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#222' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  senderName: { fontSize: 13, fontWeight: 700, marginBottom: 2 },
  senderDetail: { fontSize: 9, color: '#555' },
  metaBlock: { alignItems: 'flex-end' },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4, color: '#2F63AC' },
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
  qty: { width: 55, fontSize: 9.5, textAlign: 'right' },
  preis: { width: 70, fontSize: 9.5, textAlign: 'right' },
  rabatt: { width: 70, fontSize: 9.5, textAlign: 'right' },
  betrag: { width: 80, fontSize: 9.5, textAlign: 'right' },
  totals: { marginTop: 8, alignItems: 'flex-end' },
  totalsRow: { flexDirection: 'row', paddingTop: 3 },
  totalsLabel: { fontSize: 9.5, color: '#555', marginRight: 12 },
  totalsAmount: { width: 90, fontSize: 9.5, textAlign: 'right' },
  totalsLabelFett: { fontSize: 10.5, fontWeight: 700, color: '#222', marginRight: 12 },
  totalsAmountFett: { width: 90, fontSize: 11, fontWeight: 700, textAlign: 'right' },
  hinweise: { marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#EDEEF1' },
  hinweis: { fontSize: 9.5, color: '#222', marginTop: 3, lineHeight: 1.4 },
  footer: {
    position: 'absolute', bottom: 30, left: 40, right: 40, fontSize: 7.5, color: '#aaa',
    textAlign: 'center', borderTopWidth: 1, borderTopColor: '#EDEEF1', paddingTop: 8,
  },
})

export function AngebotDocument({ betrieb, angebot, kunde, positionen, summen, hinweise }: AngebotPdfProps) {
  // nur Rasterbilder als Logo – SVG scheitert in react-pdf an eingebetteten Schriften (siehe verkaufRechnungPdf.tsx)
  const logoIstRasterbild = !!betrieb.logoUrl && !/\.svg(\?|$)/i.test(betrieb.logoUrl)
  const mitRabatt = positionen.some(p => p.rabatt)
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
            <Text style={styles.title}>ANGEBOT</Text>
            <Text style={styles.nr}>Nr. {angebot.nummer}</Text>
            <Text style={styles.metaText}>vom {angebot.datum}</Text>
            {angebot.gueltigBis ? <Text style={styles.metaText}>gültig bis {angebot.gueltigBis}</Text> : null}
          </View>
        </View>

        <View style={styles.recipientBlock}>
          <Text style={styles.rname}>{kunde.name}</Text>
          {kunde.strasse && <Text style={styles.rdetail}>{kunde.strasse}</Text>}
          {kunde.plzOrt && <Text style={styles.rdetail}>{kunde.plzOrt}</Text>}
        </View>

        <View style={styles.tableHead}>
          <Text style={[styles.th, { flex: 1 }]}>Bezeichnung</Text>
          <Text style={[styles.th, { width: 55, textAlign: 'right' }]}>Flaschen</Text>
          <Text style={[styles.th, { width: 70, textAlign: 'right' }]}>Preis</Text>
          {mitRabatt && <Text style={[styles.th, { width: 70, textAlign: 'right' }]}>Rabatt</Text>}
          <Text style={[styles.th, { width: 80, textAlign: 'right' }]}>Betrag</Text>
        </View>

        {positionen.map((pos, i) => (
          <View key={i} style={styles.posRow} wrap={false}>
            <View style={styles.posName}>
              <Text style={styles.posTitle}>{pos.name}</Text>
              {pos.sub && <Text style={styles.posSub}>{pos.sub}</Text>}
            </View>
            <Text style={styles.qty}>{fmtZahl(pos.flaschen)}</Text>
            <Text style={styles.preis}>{fmtEur(pos.preis)}</Text>
            {mitRabatt && <Text style={styles.rabatt}>{pos.rabatt || '–'}</Text>}
            <Text style={styles.betrag}>{fmtEur(pos.betrag)}</Text>
          </View>
        ))}

        <View style={styles.totals} wrap={false}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Flaschen gesamt</Text>
            <Text style={styles.totalsAmount}>{fmtZahl(summen.flaschen)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Summe netto</Text>
            <Text style={styles.totalsAmount}>{fmtEur(summen.netto)}</Text>
          </View>
          {summen.ust.map(u => (
            <View key={u.satz} style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>USt. {fmtSatz(u.satz)} %</Text>
              <Text style={styles.totalsAmount}>{fmtEur(u.steuer)}</Text>
            </View>
          ))}
          <View style={[styles.totalsRow, { paddingTop: 6 }]}>
            <Text style={styles.totalsLabelFett}>Gesamt brutto</Text>
            <Text style={styles.totalsAmountFett}>{fmtEur(summen.brutto)}</Text>
          </View>
        </View>

        <View style={styles.hinweise}>
          <Text style={styles.hinweis}>Preise je Flasche in Euro inklusive Umsatzsteuer.</Text>
          {hinweise.map((h, i) => <Text key={i} style={styles.hinweis}>{h}</Text>)}
        </View>

        <Text style={styles.footer} fixed>{betrieb.name}{betrieb.uid ? ` · UID: ${betrieb.uid}` : ''}</Text>
      </Page>
    </Document>
  )
}

export async function renderAngebotPdf(props: AngebotPdfProps): Promise<Buffer> {
  return renderToBuffer(<AngebotDocument {...props} />)
}

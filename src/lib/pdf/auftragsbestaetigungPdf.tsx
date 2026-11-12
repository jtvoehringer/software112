// Auftragsbestätigung als PDF (KAN-418 Teil 3, 12.11.2026) – für Download und E-Mail-Anhang. Aufbau, Schrift und Kopf
// wie die Verkaufsrechnung (verkaufRechnungPdf.tsx), aber ohne Preise: Der Auftrag reserviert Flaschen, Preise
// entstehen bei der Lieferung (Entscheidung Jörgen 12.11.2026).
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

export type AuftragsbestaetigungPdfProps = {
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
  auftrag: { nummer: string; datum: string }
  kunde: { name: string; strasse: string | null; plzOrt: string | null }
  positionen: { name: string; sub: string | null; flaschen: number }[]
  flaschenGesamt: number
  /** Sätze unter den Positionen (Reservierung, Preise) */
  hinweise: string[]
}

const fmtZahl = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(n)

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
  qty: { width: 80, fontSize: 9.5, textAlign: 'right' },
  totalsRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 8 },
  totalsLabel: { fontSize: 10, fontWeight: 700, color: '#333', marginRight: 12 },
  totalsAmount: { width: 80, fontSize: 11, fontWeight: 700, textAlign: 'right' },
  hinweise: { marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#EDEEF1' },
  hinweis: { fontSize: 9.5, color: '#222', marginTop: 3, lineHeight: 1.4 },
  footer: {
    position: 'absolute', bottom: 30, left: 40, right: 40, fontSize: 7.5, color: '#aaa',
    textAlign: 'center', borderTopWidth: 1, borderTopColor: '#EDEEF1', paddingTop: 8,
  },
})

export function AuftragsbestaetigungDocument({ betrieb, auftrag, kunde, positionen, flaschenGesamt, hinweise }: AuftragsbestaetigungPdfProps) {
  // nur Rasterbilder als Logo – SVG scheitert in react-pdf an eingebetteten Schriften (siehe verkaufRechnungPdf.tsx)
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
            <Text style={styles.title}>AUFTRAGSBESTÄTIGUNG</Text>
            <Text style={styles.nr}>Nr. {auftrag.nummer}</Text>
            <Text style={styles.metaText}>Auftrag vom {auftrag.datum}</Text>
          </View>
        </View>

        <View style={styles.recipientBlock}>
          <Text style={styles.rname}>{kunde.name}</Text>
          {kunde.strasse && <Text style={styles.rdetail}>{kunde.strasse}</Text>}
          {kunde.plzOrt && <Text style={styles.rdetail}>{kunde.plzOrt}</Text>}
        </View>

        <View style={styles.tableHead}>
          <Text style={[styles.th, { flex: 1 }]}>Bezeichnung</Text>
          <Text style={[styles.th, { width: 80, textAlign: 'right' }]}>Flaschen</Text>
        </View>

        {positionen.map((pos, i) => (
          <View key={i} style={styles.posRow} wrap={false}>
            <View style={styles.posName}>
              <Text style={styles.posTitle}>{pos.name}</Text>
              {pos.sub && <Text style={styles.posSub}>{pos.sub}</Text>}
            </View>
            <Text style={styles.qty}>{fmtZahl(pos.flaschen)}</Text>
          </View>
        ))}

        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>Flaschen gesamt</Text>
          <Text style={styles.totalsAmount}>{fmtZahl(flaschenGesamt)}</Text>
        </View>

        <View style={styles.hinweise}>
          {hinweise.map((h, i) => <Text key={i} style={styles.hinweis}>{h}</Text>)}
        </View>

        <Text style={styles.footer} fixed>{betrieb.name}{betrieb.uid ? ` · UID: ${betrieb.uid}` : ''}</Text>
      </Page>
    </Document>
  )
}

export async function renderAuftragsbestaetigungPdf(props: AuftragsbestaetigungPdfProps): Promise<Buffer> {
  return renderToBuffer(<AuftragsbestaetigungDocument {...props} />)
}

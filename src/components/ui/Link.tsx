// ── Link ohne Vorabladen (Performance, 17.9.2026) ─────────────────────────────
// next/link lädt jeden sichtbaren Link im Voraus (Nav, Listen mit hunderten
// Zeilen). Da alle Seiten dynamisch sind, führt jedes Vorabladen zu einem
// Serverless-Aufruf inkl. Layout-Datenbankabfragen - in den Vercel-Logs
// tauchten beim Öffnen einer Seite 10–20 weitere Seitenrenderings auf, bei
// der Kontaktliste je sichtbarer Zeile eines. Deshalb hier prefetch={false}
// als Standard; einzelne Links können prefetch explizit wieder einschalten.
import NextLink from 'next/link'
import type { ComponentProps } from 'react'

export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />
}

'use client'
// ── HTML-Inhalt einer E-Mail sicher anzeigen (KAN-137, 26.9.2026) ─────────────
// E-Mail-HTML ist fremder, unbereinigter Inhalt (Graph liefert es 1:1 vom
// Absender; gespeichert in aktivitaeten.email_body_html). Es darf deshalb NIE per
// dangerouslySetInnerHTML in die App-Seite – sonst liefe eingeschleustes Skript
// (z. B. ein Bild-Tag mit onerror-Handler) mit der Sitzung des Benutzers (gespeichertes XSS).
//
// Stattdessen: iframe mit srcDoc und sandbox
//   - OHNE allow-scripts: kein JavaScript im Mail-Inhalt (auch keine Event-Handler)
//   - OHNE allow-same-origin: das Dokument läuft in einer undurchsichtigen
//     Herkunft, kommt also weder an Cookies/Storage noch an das DOM der App
//   - OHNE allow-forms: Formulare in Mails lassen sich nicht absenden
//   - allow-popups + allow-popups-to-escape-sandbox: Links öffnen über
//     <base target="_blank"> in einem neuen Tab, und die Zielseite läuft dort
//     normal (sonst erbte sie die Sandbox und würde ohne Skripte kaputt angezeigt)
// Folge von „ohne allow-same-origin“: die Höhe kann nicht am Inhalt ausgerichtet
// werden (kein Zugriff auf contentDocument, ohne Skripte auch kein postMessage) –
// der Rahmen hat daher eine feste Höhe und scrollt innen.
// Zusätzlich: Referrer unterdrückt (Tracking-Pixel sehen die App-URL nicht) und
// eine CSP im Dokument, die Skripte und Plugins auch ohne Sandbox verbietet.

import type { CSSProperties } from 'react'

type Props = {
  html: string
  /** Schriftgröße des Mailtexts (Standard 13px wie unter Nachrichten) */
  schriftgroesse?: string
  /** Innenabstand des Mailtexts (CSS padding, Standard 0) */
  innenabstand?: string
  className?: string
  style?: CSSProperties
  title?: string
}

export default function EmailHtmlAnzeige({ html, schriftgroesse = '13px', innenabstand = '0', className, style, title = 'E-Mail-Inhalt' }: Props) {
  const srcDoc =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'; object-src \'none\'">' +
    '<meta name="referrer" content="no-referrer">' +
    '<base target="_blank">' +
    `<style>body{font-family:Arial,sans-serif;font-size:${schriftgroesse};color:#22252B;margin:0;padding:${innenabstand};word-wrap:break-word}a{color:#4F86D6}img{max-width:100%;height:auto}</style>` +
    `</head><body>${html}</body></html>`
  return (
    <iframe
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className={className ?? 'w-full border-0 block'}
      style={style}
    />
  )
}

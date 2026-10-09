// Sweep 81 (09.10.2026): scripts/katalog-abgleich.sql vergleicht den Katalog von Produktion und Staging (Fingerabdruck je
// Objektart). Es läuft als postgres gegen beide Datenbanken – ein Schreibbefehl darin würde ohne RLS ausgeführt.
// Hier: rein lesend, alle Objektarten erfasst, Funktionen ohne Leerraum-/Kommentar-Rauschen verglichen.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const SQL = fs.readFileSync(path.join(HIER, '..', 'katalog-abgleich.sql'), 'utf8')
// nur ganzzeilige Kommentare entfernen – im Code steht das Muster '--[^\n]*' (Kommentare aus Funktionstexten streichen)
const CODE = SQL.split('\n').filter(z => !/^\s*--/.test(z)).join('\n')

describe('scripts/katalog-abgleich.sql', () => {
  test('nur lesend: keine Schreib-, DDL- oder Sitzungsbefehle', () => {
    assert.doesNotMatch(CODE, /\b(insert|update|delete|truncate|merge|drop|alter|create|grant|revoke|copy|call)\b/i)
    assert.doesNotMatch(CODE, /set_config|\bset\s+(?!search_path)/i)
    assert.match(CODE, /^\s*with objekte\(art, name, def\) as/m)
  })

  test('alle Objektarten des Abgleichs sind erfasst', () => {
    const arten = [...CODE.matchAll(/select '([a-z_]+)',/g)].map(m => m[1])
    for (const a of ['spalte', 'index', 'constraint', 'funktion', 'policy', 'trigger', 'tabellenrecht', 'spaltenrecht',
      'rls', 'view', 'typ', 'extension', 'event_trigger', 'bucket']) assert.ok(arten.includes(a), a)
    assert.equal(new Set(arten).size, arten.length, 'Art doppelt')
  })

  test('Funktionen normalisiert (CRLF, Kommentare, Leerraum), Trigger auch auf auth.users', () => {
    assert.match(CODE, /replace\(p\.prosrc, chr\(13\), ''\)/)
    assert.match(SQL, /'--\[\^\\n\]\*'/)
    assert.match(CODE, /'\\s\+', ' '/)
    assert.match(CODE, /n\.nspname in \('public', 'auth', 'storage'\)/)
  })
})

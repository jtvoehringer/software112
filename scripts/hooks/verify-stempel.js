#!/usr/bin/env node
// Letzter Schritt von `npm run verify` (nur erreicht, wenn alles davor grün war): Fingerabdruck des geprüften Stands
// nach .claude/verify-stempel schreiben – das Stopp-Gate (done-gate.js) vergleicht damit. In der CI harmlos.
const fs = require('fs')
const path = require('path')
const { fingerabdruck, STEMPEL } = require('./stand')

const stand = fingerabdruck()
fs.mkdirSync(path.dirname(STEMPEL), { recursive: true })
fs.writeFileSync(STEMPEL, stand + '\n')
console.log(`✓ verify-Stempel geschrieben (${stand ? stand.slice(0, 12) : 'keine Änderungen'}).`)

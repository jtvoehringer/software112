import type { Metadata } from 'next'
import ImportClient from './ImportClient'
export const metadata: Metadata = { title: 'Datenimport – software:112' }

export default function ImportPage() {
  return <ImportClient />
}

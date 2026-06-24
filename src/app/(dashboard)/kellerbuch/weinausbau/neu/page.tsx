import { redirect } from 'next/navigation'

export const metadata = { title: 'Neue Charge – software:112' }
export const dynamic = 'force-dynamic'

// Chargen werden ausschließlich über Pressungen oder Verschneidungen angelegt
export default function NeuePage() {
  redirect('/erntemeldung')
}

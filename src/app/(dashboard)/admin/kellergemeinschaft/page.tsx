import { redirect } from 'next/navigation'

// KAN-212 (06.10.2026): Administration › Kellergemeinschaft heißt jetzt Gemeinschaften (Keller- und CRM-Gemeinschaft)
export default function KellergemeinschaftAlt() {
  redirect('/admin/gemeinschaften')
}

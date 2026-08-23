import { redirect } from 'next/navigation';

/** The Library is the front door; there is no separate home screen. */
export default function HomePage() {
  redirect('/library');
}

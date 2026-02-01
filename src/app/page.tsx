import { redirect } from 'next/navigation';

// Redirect the root URL to the primary graph.
export default function Home() {
  redirect('/graph/sga4-5');
}

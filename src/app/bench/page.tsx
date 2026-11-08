import { BenchApp } from '@/components/bench/bench-app';
import { benchData } from './bench-data';

/**
 * Server Component. Builds the repository, the diffs and the fixture view on
 * the server (where `node:crypto` lives) and hands plain values to the client
 * instrument.
 */
export default function Page() {
  return <BenchApp data={benchData()} />;
}

/**
 * Server Component. Builds the history out of the real modules — `lib/vcs` and
 * `lib/safety` both need `node:crypto`, so this work stays on the server — and
 * hands the client a plain serializable view model.
 */

import { buildScenario } from '@/lib/demo/scenario';
import { Workspace } from '@/components/workspace';

export default function Page() {
  const { view } = buildScenario();
  return <Workspace initial={view} />;
}

/**
 * The SigmaFold workspace.
 *
 * A server component whose only job is composition: build the workspace from
 * the real modules and hand it to the client shell. Resolving the data here
 * rather than in the browser is not an optimisation — `lib/vcs`, `lib/agents`
 * and `lib/safety` reach `node:crypto` and cannot run client-side at all.
 */

import { AppShell } from '@/components/shell/app-shell';
import { buildWorkspace } from '@/components/shell/model/workspace';

export default function Home() {
  const workspace = buildWorkspace();
  return <AppShell workspace={workspace} />;
}

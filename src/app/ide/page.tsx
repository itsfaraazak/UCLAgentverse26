import { Workbench } from '@/components/shell/workbench';
import { buildWorkspace } from '@/lib/workspace';

/**
 * Server component. `buildWorkspace()` reaches into `lib/vcs`, which hashes
 * with `node:crypto`, so the repository is built here and handed to the client
 * as a plain snapshot. The client imports no value from the safety or vcs
 * modules, which is checked by src/lib/run-view/steps.test.ts rather than
 * asserted here — this comment was wrong once already.
 */
export default function Page() {
  const workspace = buildWorkspace();
  return <Workbench workspace={workspace} />;
}

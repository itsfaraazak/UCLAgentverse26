import { Workbench } from '@/components/shell/workbench';
import { buildWorkspace } from '@/lib/workspace';

/**
 * Server component. `buildWorkspace()` reaches into `lib/vcs`, which hashes
 * with `node:crypto`, so the repository is built here and handed to the client
 * as a plain snapshot — the client never imports the safety or vcs modules.
 */
export default function Page() {
  const workspace = buildWorkspace();
  return <Workbench workspace={workspace} />;
}

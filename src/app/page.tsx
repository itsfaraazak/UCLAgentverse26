/**
 * The SigmaFold Workbench.
 *
 * The workspace store lives in the server process behind `/api/workbench`, so
 * this page stays static and the client loads the snapshot on mount. The
 * genome-VCS shell that used to live here is at `/classic`.
 */

import { Workbench } from '@/components/workbench/workbench';

export default function Home() {
  return <Workbench />;
}

import '../ai/server-only';
import { getEvidenceService } from '../evidence';
import { aiStatus, defaultGeminiClient } from './gemini';
import { WorkbenchService } from './service';
import { getStore } from './store';

/**
 * The workbench wired to the real store, evidence and model. Only the store
 * holds state; the service is rebuilt per request so dev HMR picks up edits.
 */
export function getWorkbench(): WorkbenchService {
  return new WorkbenchService({
    store: getStore(),
    evidence: getEvidenceService,
    gemini: defaultGeminiClient,
    ai: aiStatus,
  });
}

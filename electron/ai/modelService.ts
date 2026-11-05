import type { Model } from '../../shared/contracts.ts';
import { AiError, requestIdentifier, responseError } from './aiError.ts';

export async function readModelCatalog(response: Response): Promise<Model[]> {
  const requestId = requestIdentifier(response);
  const unreadable = () => new AiError('protocol', requestId, response.status, 'model-catalog');
  let catalog: { models?: unknown; object?: unknown; data?: unknown; error?: unknown };
  try {
    catalog = await response.json();
  } catch {
    throw unreadable();
  }
  if (!catalog || typeof catalog !== 'object') throw unreadable();
  if (catalog.error) throw responseError(catalog.error, requestId, response.status, false, 'model-catalog');

  const siwcCatalog = Array.isArray(catalog.models) ? catalog.models : undefined;
  const restCatalog = catalog.object === 'list' && Array.isArray(catalog.data) ? catalog.data : undefined;
  const entries = siwcCatalog ?? restCatalog;
  if (!entries) throw unreadable();

  const models = new Map<string, Model>();
  for (const model of entries) {
    if (!model || typeof model !== 'object') continue;
    if (siwcCatalog ? model.visibility !== 'list' : model.object !== 'model' ||
      (model.visibility !== undefined && model.visibility !== 'list')) continue;
    const id = siwcCatalog ? model.slug : model.id;
    if (typeof id !== 'string' || !id.trim() || models.has(id)) continue;
    const name = typeof model.display_name === 'string' && model.display_name.trim() ? model.display_name : id;
    models.set(id, { id, name });
  }
  return [...models.values()];
}

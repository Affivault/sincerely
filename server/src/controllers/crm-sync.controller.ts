import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { AppError } from '../middleware/error.middleware.js';
import { crmSyncService, runCrmSync } from '../services/crm-sync.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed id is "not found", not a database error. */
function id(value: unknown): string {
  const s = String(value || '');
  if (!UUID.test(s)) throw new AppError('Not found', 404);
  return s;
}

type Handler = (req: AuthRequest) => Promise<unknown>;
const wrap = (fn: Handler, status = 200) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.status(status).json(await fn(req));
  } catch (err) {
    next(err);
  }
};

export const crmSyncController = {
  overview: wrap((req) => crmSyncService.overview(req.userId!, id(req.params.id))),
  updateSettings: wrap((req) => crmSyncService.updateSettings(req.userId!, id(req.params.id), req.body || {})),
  options: wrap((req) => crmSyncService.options(req.userId!, id(req.params.id))),
  run: wrap((req) => runCrmSync(req.userId!, id(req.params.id), { force: true })),
  log: wrap((req) => crmSyncService.log(req.userId!, id(req.params.id), {
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    direction: typeof req.query.direction === 'string' ? req.query.direction : undefined,
    before: typeof req.query.before === 'string' ? req.query.before : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  })),
  retry: wrap((req) => crmSyncService.retry(req.userId!, id(req.params.id), id(req.params.logId))),
  retryAll: wrap((req) => crmSyncService.retryAll(req.userId!, id(req.params.id))),
  addList: wrap((req) => crmSyncService.addListSync(req.userId!, id(req.params.id), req.body || {}), 201),
  updateList: wrap((req) => crmSyncService.updateListSync(req.userId!, id(req.params.id), id(req.params.listSyncId), req.body || {})),
  removeList: wrap((req) => crmSyncService.removeListSync(req.userId!, id(req.params.id), id(req.params.listSyncId))),
  runList: wrap((req) => crmSyncService.runListNow(req.userId!, id(req.params.id), id(req.params.listSyncId))),
};

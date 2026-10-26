import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { linkedinAgentService } from '../services/linkedin-agent.service.js';

/* The browser extension talks to these endpoints. It sends an API key and
   nothing else — no LinkedIn cookie, no session, no credentials. */
export const linkedinRoutes = Router();

linkedinRoutes.get('/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await linkedinAgentService.status(req.userId!)); } catch (e) { next(e); }
});

linkedinRoutes.get('/settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await linkedinAgentService.getSettings(req.userId!)); } catch (e) { next(e); }
});

linkedinRoutes.put('/settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await linkedinAgentService.updateSettings(req.userId!, req.body)); } catch (e) { next(e); }
});

/** What the agent has done and is about to do, for the LinkedIn page. */
linkedinRoutes.get('/activity', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await linkedinAgentService.activity(req.userId!, Number(req.query.limit) || 60)); } catch (e) { next(e); }
});

/**
 * "Anything to do right now?" — the extension's only question. `caps` is a
 * comma-separated list of what this extension build can do, so an older
 * one is never handed an action it does not know.
 */
linkedinRoutes.get('/agent/next', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const caps = String(req.query.caps || '').split(',').map((c) => c.trim()).filter(Boolean).slice(0, 10);
    res.json(await linkedinAgentService.nextAction(req.userId!, caps));
  } catch (e) { next(e); }
});

/** Profile facts and invite state ride along with a done or a failure. */
function reportFrom(body: any) {
  return {
    profile: body?.profile && typeof body.profile === 'object' ? body.profile : null,
    state: typeof body?.state === 'string' ? body.state.slice(0, 40) : null,
  };
}

linkedinRoutes.post('/agent/tasks/:id/done', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await linkedinAgentService.complete(req.userId!, req.params.id, reportFrom(req.body))); } catch (e) { next(e); }
});

/** How an acceptance check, a withdrawal or an inbox read went. */
linkedinRoutes.post('/agent/report', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await linkedinAgentService.report(req.userId!, req.body)); } catch (e) { next(e); }
});

linkedinRoutes.post('/agent/tasks/:id/failed', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // kind says whether the failure is about the account (signed out,
    // restricted, LinkedIn's weekly limit) rather than about this task.
    const { reason, fatal, kind } = req.body || {};
    res.json(await linkedinAgentService.fail(
      req.userId!, req.params.id, reason, !!fatal, typeof kind === 'string' ? kind : null, reportFrom(req.body),
    ));
  } catch (e) { next(e); }
});

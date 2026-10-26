import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { linkedinAgentService } from '../services/linkedin-agent.service.js';

/* The browser extension talks to exactly these five endpoints. It sends an
   API key and nothing else — no LinkedIn cookie, no session, no credentials. */
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

/** "Anything to do right now?" — the extension's only question. */
linkedinRoutes.get('/agent/next', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await linkedinAgentService.nextAction(req.userId!)); } catch (e) { next(e); }
});

linkedinRoutes.post('/agent/tasks/:id/done', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await linkedinAgentService.complete(req.userId!, req.params.id)); } catch (e) { next(e); }
});

linkedinRoutes.post('/agent/tasks/:id/failed', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // kind says whether the failure is about the account (signed out,
    // restricted, LinkedIn's weekly limit) rather than about this task.
    const { reason, fatal, kind } = req.body || {};
    res.json(await linkedinAgentService.fail(
      req.userId!, req.params.id, reason, !!fatal, typeof kind === 'string' ? kind : null,
    ));
  } catch (e) { next(e); }
});

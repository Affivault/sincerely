import { Router } from 'express';
import { platformSettings } from '../services/platform-settings.service.js';

/*
 * What the app needs to know before anyone signs in: whether sign-ups are
 * open, the owners' announcement, and the live prices and plan limits.
 * Public, and nothing in it is private.
 */
export const platformRoutes = Router();

platformRoutes.get('/', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'public, max-age=30');
    res.json(await platformSettings.publicInfo());
  } catch (err) { next(err); }
});

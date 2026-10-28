import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { prospectingService } from '../services/prospecting.service.js';
import { companyDirectoryService } from '../services/company-directory.service.js';
import { suggestPlaces } from '../services/place-suggest.js';
import { getActiveProvider } from '../services/prospect-providers.js';
import { AppError } from '../middleware/error.middleware.js';

export const prospectingController = {
  /** GET /prospecting/status — configured provider + this month's credits */
  async status(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await prospectingService.status(req.userId!)); } catch (err) { next(err); }
  },

  /** POST /prospecting/search — run a filtered people search (no emails returned) */
  async search(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { filters, page } = req.body || {};
      res.json(await prospectingService.search(req.userId!, filters || {}, Number(page) || 1));
    } catch (err) { next(err); }
  },

  /** POST /prospecting/count — free match count for the filters (null when the provider can't say) */
  async count(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await prospectingService.count((req.body || {}).filters || {})); } catch (err) { next(err); }
  },

  /** GET /prospecting/suggest/locations?q= — countries, regions, metros and towns for the location filters */
  async suggestLocations(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(suggestPlaces(String(req.query.q || ''))); } catch (err) { next(err); }
  },

  /**
   * POST /prospecting/companies/search — our free directory when it is
   * loaded, otherwise Icypeas's company database (search credits).
   */
  async searchCompanies(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { filters, page } = req.body || {};
      const p = Math.min(Math.max(1, Number(page) || 1), 40);
      if ((await companyDirectoryService.status()).available) {
        return res.json({ ...(await companyDirectoryService.search(filters || {}, p)), source: 'directory' });
      }
      if (getActiveProvider()?.id !== 'icypeas') throw new AppError('Company search needs the Icypeas key or the company directory.', 400);
      res.json(await prospectingService.searchCompanies(req.userId!, filters || {}, p).catch((e: any) => {
        if (e instanceof AppError) throw e;
        throw new AppError(/at least one filter/.test(e?.message) ? e.message : `Company search failed: ${e?.message || 'provider error'}`, /at least one filter/.test(e?.message) ? 400 : 502);
      }));
    } catch (err) { next(err); }
  },

  /** GET /prospecting/destinations — lead lists to save into, with the campaigns each feeds */
  async destinations(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await prospectingService.destinations(req.userId!)); } catch (err) { next(err); }
  },

  /** POST /prospecting/reveal — spend a credit, save the lead as a contact */
  async reveal(req: AuthRequest, res: Response, next: NextFunction) {
    try { res.json(await prospectingService.reveal(req.userId!, req.body || {})); } catch (err) { next(err); }
  },
};

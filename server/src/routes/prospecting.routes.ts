import { Router } from 'express';
import { prospectingController } from '../controllers/prospecting.controller.js';

export const prospectingRoutes = Router();

prospectingRoutes.get('/status', prospectingController.status);
prospectingRoutes.post('/search', prospectingController.search);
prospectingRoutes.post('/reveal', prospectingController.reveal);

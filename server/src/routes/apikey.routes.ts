import { Router } from 'express';
import { apikeyController } from '../controllers/apikey.controller.js';
import { jwtOnly } from '../middleware/apikey.middleware.js';

export const apikeyRoutes = Router();

apikeyRoutes.get('/', apikeyController.list);
// Managing API keys (minting a new one, revoking/deleting) must require a
// real user session — an API key must never be able to mint or revoke keys.
apikeyRoutes.post('/', jwtOnly, apikeyController.create);
// A key's secret is hashed and cannot be shown twice; rotating issues a new one
// for the same key rather than forcing a delete-and-recreate.
apikeyRoutes.post('/:id/rotate', jwtOnly, apikeyController.rotate);
apikeyRoutes.post('/:id/revoke', jwtOnly, apikeyController.revoke);
apikeyRoutes.delete('/:id', jwtOnly, apikeyController.delete);

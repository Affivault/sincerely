import { Router } from 'express';
import { verificationController } from '../controllers/verification.controller.js';

export const verificationRoutes = Router();

// Verify a single contact by ID
verificationRoutes.post('/contacts/:contactId', verificationController.verifyContact);

// Verify a raw email address
verificationRoutes.post('/email', verificationController.verifyEmail);

// Find the address for a name at a domain, when nothing published it
verificationRoutes.post('/find-email', verificationController.findEmail);

// Batch verify contacts
verificationRoutes.post('/batch', verificationController.batchVerify);

// DCS statistics
verificationRoutes.get('/stats', verificationController.getDcsStats);

// Get suppressed contacts for a campaign
verificationRoutes.get('/campaigns/:campaignId/suppressed', verificationController.getSuppressed);

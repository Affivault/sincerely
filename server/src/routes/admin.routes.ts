import { Router } from 'express';
import { adminOnly } from '../middleware/admin.middleware.js';
import { jwtOnly } from '../middleware/apikey.middleware.js';
import { adminController } from '../controllers/admin.controller.js';

export const adminRoutes = Router();

// Every admin route sits behind the owner-only gate (checked first so a
// non-admin caller gets an existence-hiding 404, not a 403). Since these
// endpoints can dump every account's email/plan or grant lifetime access,
// jwtOnly follows: an API key must never reach them, even one minted by the
// admin account itself.
adminRoutes.use(adminOnly);
adminRoutes.use(jwtOnly);

adminRoutes.get('/users', adminController.listUsers);
adminRoutes.get('/stats', adminController.stats);
adminRoutes.get('/usage', adminController.usage);
adminRoutes.get('/billing', adminController.billing);
adminRoutes.get('/health', adminController.health);
adminRoutes.post('/sync', adminController.sync);
adminRoutes.post('/grant-lifetime', adminController.grantLifetime);
adminRoutes.post('/revoke-lifetime', adminController.revokeLifetime);

adminRoutes.get('/accounts', adminController.accounts);
adminRoutes.get('/accounts/:id', adminController.account);
adminRoutes.post('/accounts/:id/plan', adminController.setPlan);
adminRoutes.post('/accounts/:id/stripe-sync', adminController.syncStripe);
adminRoutes.post('/accounts/:id/allowance', adminController.setAllowance);
adminRoutes.post('/accounts/:id/credits', adminController.adjustCredits);
adminRoutes.post('/accounts/:id/suspend', adminController.suspend);
adminRoutes.post('/accounts/:id/unsuspend', adminController.unsuspend);
adminRoutes.post('/accounts/:id/note', adminController.setNote);
adminRoutes.get('/audit', adminController.audit);

// Billing, changed in Stripe itself.
adminRoutes.post('/accounts/:id/cancel', adminController.cancelSubscription);
adminRoutes.post('/accounts/:id/resume', adminController.resumeSubscription);
adminRoutes.post('/accounts/:id/extend-trial', adminController.extendTrial);
adminRoutes.post('/accounts/:id/stripe-credit', adminController.stripeCredit);
adminRoutes.post('/accounts/:id/discount', adminController.discount);
adminRoutes.delete('/accounts/:id/discount', adminController.removeDiscount);
adminRoutes.post('/accounts/:id/refund', adminController.refund);

// The account itself.
adminRoutes.post('/accounts/:id/sign-in-link', adminController.signInLink);
adminRoutes.post('/accounts/:id/reset-email', adminController.resetEmail);
adminRoutes.post('/accounts/:id/email', adminController.changeEmail);
adminRoutes.post('/accounts/:id/verify-email', adminController.verifyEmail);
adminRoutes.post('/accounts/:id/sign-out', adminController.signOut);
adminRoutes.post('/accounts/:id/pause-campaigns', adminController.pauseCampaigns);
adminRoutes.post('/accounts/:id/sending-hold', adminController.sendingHold);
adminRoutes.post('/accounts/:id/view-as', adminController.viewAs);
adminRoutes.post('/accounts/:id/delete', adminController.deleteAccount);
adminRoutes.post('/accounts/:id/overrides', adminController.overrides);

// The platform: settings that apply to everyone, and sending across every account.
adminRoutes.get('/settings', adminController.settings);
adminRoutes.post('/settings/plans', adminController.savePlans);
adminRoutes.post('/settings/prices', adminController.savePrices);
adminRoutes.post('/settings/signups', adminController.saveSignups);
adminRoutes.post('/settings/announcement', adminController.saveAnnouncement);
adminRoutes.post('/settings/kill-switch', adminController.killSwitch);
adminRoutes.get('/sending', adminController.sending);
adminRoutes.post('/mailboxes/:mailboxId/active', adminController.mailboxActive);

import { Router } from 'express';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { teamService } from '../services/team.service.js';
import { jwtOnly } from '../middleware/apikey.middleware.js';
import { supabaseAdmin } from '../config/supabase.js';

export const teamRoutes = Router();

// Organisation
teamRoutes.get('/org', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const org = await teamService.getOrCreateOrg(req.userId!);
    res.json(org);
  } catch (err) { next(err); }
});

teamRoutes.put('/org', jwtOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const org = await teamService.updateOrg(req.userId!, name);
    res.json(org);
  } catch (err) { next(err); }
});

// Members
teamRoutes.get('/members', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const members = await teamService.listMembers(req.userId!);
    res.json(members);
  } catch (err) { next(err); }
});

teamRoutes.delete('/members/:memberId', jwtOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await teamService.removeMember(req.userId!, req.params.memberId);
    res.status(204).send();
  } catch (err) { next(err); }
});

teamRoutes.put('/members/:memberId/role', jwtOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { role } = req.body;
    if (!role) return res.status(400).json({ error: 'role is required' });
    const member = await teamService.updateMemberRole(req.userId!, req.params.memberId, role);
    res.json(member);
  } catch (err) { next(err); }
});

// Invites
teamRoutes.get('/invites', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const invites = await teamService.listInvites(req.userId!);
    res.json(invites);
  } catch (err) { next(err); }
});

teamRoutes.post('/invites', jwtOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { email, role } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });
    const invite = await teamService.invite(req.userId!, email, role);
    res.status(201).json(invite);
  } catch (err) { next(err); }
});

teamRoutes.delete('/invites/:inviteId', jwtOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await teamService.revokeInvite(req.userId!, req.params.inviteId);
    res.status(204).send();
  } catch (err) { next(err); }
});

// Accept invite (public — token-based)
teamRoutes.post('/invites/accept', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token is required' });
    const { data: user } = await supabaseAdmin.auth.admin.getUserById(req.userId!);
    const userEmail = user?.user?.email;
    if (!userEmail) return res.status(400).json({ error: 'Could not determine user email' });
    const result = await teamService.acceptInvite(token, req.userId!, userEmail);
    res.json(result);
  } catch (err) { next(err); }
});

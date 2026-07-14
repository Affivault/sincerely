// Admin console — platform-owner only.

/** The only account(s) allowed into the admin console. Checked server-side
 *  against the verified session email; the client copy is cosmetic. */
export const ADMIN_EMAILS = ['steven@usesincerely.com'];

export interface AdminUserRow {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  plan: string;
  status: string;
}

export interface AdminStats {
  total_users: number;
  lifetime_users: number;
  paying_users: number;
  free_users: number;
  mailboxes: number;
  domains: number;
  contacts: number;
  campaigns: number;
}

export interface AdminUsersResponse {
  users: AdminUserRow[];
  total: number;
}

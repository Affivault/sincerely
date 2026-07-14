import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3001'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().optional().default(''),
  REDIS_URL: z.string().optional().default(''),
  API_BASE_URL: z.string().default('http://localhost:3001'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  TRACKING_BASE_URL: z.string().default('http://localhost:3001'),
  TRACKING_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z.string().length(64),
  SMTP_RELAY_URL: z.string().optional().default(''),
  SMTP_RELAY_SECRET: z.string().optional().default(''),
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  // Prospector data providers — set one key to switch the built-in
  // prospect search on. PDL takes priority when both are configured.
  PDL_API_KEY: z.string().optional().default(''),
  APOLLO_API_KEY: z.string().optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

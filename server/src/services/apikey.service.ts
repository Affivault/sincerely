import { supabaseAdmin } from '../config/supabase.js';
import crypto from 'crypto';
import type { ApiKey, CreateApiKeyInput, ApiKeyCreatedResponse } from '@lemlist/shared';

/**
 * API Key Management Service
 * Generates, validates, and manages API keys for headless platform access.
 */

const KEY_PREFIX_LENGTH = 8;

/**
 * Generate a new API key.
 * Returns the raw key only once - it's hashed before storage.
 */
export async function createKey(
  userId: string,
  input: CreateApiKeyInput
): Promise<ApiKeyCreatedResponse> {
  // Generate a secure random key
  const rawKey = `sk_live_${crypto.randomBytes(32).toString('hex')}`;
  const keyPrefix = rawKey.substring(0, KEY_PREFIX_LENGTH + 8); // "sk_live_" + 8 chars
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .insert({
      user_id: userId,
      name: input.name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scopes: input.scopes || ['read', 'write'],
      rate_limit: input.rate_limit || 100,
      expires_at: input.expires_at || null,
    })
    .select()
    .single();

  if (error) throw error;

  // Strip key_hash from response
  const { key_hash, ...key } = data;
  return { key: key as ApiKey, raw_key: rawKey };
}

/**
 * List all API keys for a user (never exposes hashes).
 */
export async function listKeys(userId: string): Promise<ApiKey[]> {
  const { data } = await supabaseAdmin
    .from('api_keys')
    .select('id, user_id, name, key_prefix, scopes, rate_limit, last_used_at, expires_at, is_active, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return data || [];
}

/**
 * Revoke (deactivate) an API key.
 */
export async function revokeKey(userId: string, keyId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .update({ is_active: false })
    .eq('id', keyId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('API key not found');
}

/**
 * Delete an API key permanently.
 */
export async function deleteKey(userId: string, keyId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .delete()
    .eq('id', keyId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('API key not found');
}

/**
 * Validate an API key and return the user context.
 * Used by the API key auth middleware.
 */
export async function validateKey(
  rawKey: string
): Promise<{ keyId: string; userId: string; scopes: string[]; rateLimit: number } | null> {
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const { data } = await supabaseAdmin
    .from('api_keys')
    .select('id, user_id, scopes, rate_limit, is_active, expires_at')
    .eq('key_hash', keyHash)
    .single();

  if (!data) return null;
  if (!data.is_active) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Update last_used_at
  await supabaseAdmin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);

  return {
    keyId: data.id,
    userId: data.user_id,
    scopes: data.scopes,
    rateLimit: data.rate_limit,
  };
}

import { supabaseAdmin } from '../config/supabase.js';
import type { AssetTemplate, CreateAssetTemplateInput, AssetTemplateLayer } from '@lemlist/shared';
import crypto from 'crypto';

/**
 * Dynamic Asset Generation Service
 * Generates personalized images on-the-fly based on templates and prospect data.
 */

// In-memory cache for rendered assets
const renderCache = new Map<string, { buffer: Buffer; expires: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_MAX_ENTRIES = 500;

/**
 * Generate a personalized asset URL for email embedding.
 */
export function buildAssetUrl(
  baseUrl: string,
  templateId: string,
  params: Record<string, string>
): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) searchParams.set(key, value);
  }
  return `${baseUrl}/api/assets/render/${templateId}?${searchParams.toString()}`;
}

/**
 * Interpolate merge tags in text content.
 * Replaces {{key}} with the corresponding value from params.
 */
export function interpolateText(text: string, params: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return params[key] || match;
  });
}

/**
 * Render a personalized asset as SVG (lightweight, no canvas dependency).
 * Returns SVG string that can be converted to PNG on the client or cached as-is.
 */
export function renderAssetSvg(
  template: AssetTemplate,
  params: Record<string, string>
): string {
  const { width, height, background_color, layers } = template;

  let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;

  // Background
  svgContent += `<rect width="${width}" height="${height}" fill="${escapeXml(background_color)}" />`;

  // Render layers
  for (const layer of layers) {
    svgContent += renderLayer(layer, params);
  }

  svgContent += `</svg>`;
  return svgContent;
}

function renderLayer(layer: AssetTemplateLayer, params: Record<string, string>): string {
  switch (layer.type) {
    case 'text': {
      const text = interpolateText(layer.content || '', params);
      const escaped = escapeXml(text);
      const fontSize = layer.fontSize || 24;
      const fontFamily = escapeXml(layer.fontFamily || 'Arial, sans-serif');
      const fontWeight = escapeXml(layer.fontWeight || 'normal');
      const color = escapeXml(layer.color || '#000000');
      const anchor = layer.align === 'center' ? 'middle' : layer.align === 'right' ? 'end' : 'start';
      const x = layer.align === 'center'
        ? layer.x + (layer.width || 0) / 2
        : layer.align === 'right'
        ? layer.x + (layer.width || 0)
        : layer.x;

      return `<text x="${x}" y="${layer.y + fontSize}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${color}" text-anchor="${anchor}">${escaped}</text>`;
    }

    case 'shape': {
      const fill = escapeXml(layer.fill || '#e5e7eb');
      const opacity = layer.opacity !== undefined ? layer.opacity : 1;
      const rx = layer.borderRadius || 0;

      if (layer.shape === 'circle') {
        const cx = layer.x + (layer.width || 0) / 2;
        const cy = layer.y + (layer.height || 0) / 2;
        const r = Math.min(layer.width || 0, layer.height || 0) / 2;
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="${opacity}" />`;
      }

      return `<rect x="${layer.x}" y="${layer.y}" width="${layer.width || 0}" height="${layer.height || 0}" rx="${rx}" fill="${fill}" opacity="${opacity}" />`;
    }

    case 'image': {
      if (!layer.src) return '';
      return `<image href="${escapeXml(layer.src)}" x="${layer.x}" y="${layer.y}" width="${layer.width || 100}" height="${layer.height || 100}" />`;
    }

    default:
      return '';
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate a cache key for a rendered asset.
 */
export function getCacheKey(templateId: string, params: Record<string, string>): string {
  const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const hash = crypto.createHash('md5').update(JSON.stringify([templateId, sorted])).digest('hex');
  return `asset:${hash}`;
}

/**
 * Get a cached render or return null.
 */
export function getCachedRender(cacheKey: string): Buffer | null {
  const cached = renderCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.buffer;
  }
  if (cached) renderCache.delete(cacheKey);
  return null;
}

/**
 * Cache a rendered asset.
 */
export function cacheRender(cacheKey: string, buffer: Buffer): void {
  renderCache.delete(cacheKey); // re-insert at the end so eviction order reflects recency
  renderCache.set(cacheKey, { buffer, expires: Date.now() + CACHE_TTL });

  // Evict over the cap: expired entries first, then oldest-inserted (a public,
  // attacker-controlled query-param cache key means this cap must hold even
  // when nothing has expired yet, or the cache grows unbounded for 24h).
  if (renderCache.size > CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [key, value] of renderCache) {
      if (renderCache.size <= CACHE_MAX_ENTRIES) break;
      if (value.expires < now) renderCache.delete(key);
    }
    while (renderCache.size > CACHE_MAX_ENTRIES) {
      const oldestKey = renderCache.keys().next().value;
      if (oldestKey === undefined) break;
      renderCache.delete(oldestKey);
    }
  }
}

// ============================================
// CRUD operations for asset templates
// ============================================

export async function listTemplates(userId: string): Promise<AssetTemplate[]> {
  const { data } = await supabaseAdmin
    .from('asset_templates')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function getTemplate(userId: string, id: string): Promise<AssetTemplate | null> {
  const { data } = await supabaseAdmin
    .from('asset_templates')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  return data;
}

export async function createTemplate(
  userId: string,
  input: CreateAssetTemplateInput
): Promise<AssetTemplate> {
  const { data, error } = await supabaseAdmin
    .from('asset_templates')
    .insert({
      user_id: userId,
      name: input.name,
      width: input.width || 600,
      height: input.height || 315,
      background_color: input.background_color || '#ffffff',
      layers: input.layers || [],
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateTemplate(
  userId: string,
  id: string,
  input: Partial<CreateAssetTemplateInput>
): Promise<AssetTemplate> {
  const { data, error } = await supabaseAdmin
    .from('asset_templates')
    .update(input)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteTemplate(userId: string, id: string): Promise<void> {
  await supabaseAdmin
    .from('asset_templates')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
}

/**
 * Get preset templates for new users.
 */
export function getPresetTemplates(): CreateAssetTemplateInput[] {
  return [
    {
      name: 'Welcome Banner',
      width: 600,
      height: 200,
      background_color: '#4F46E5',
      layers: [
        {
          type: 'text',
          content: 'Hey {{first_name}}!',
          x: 30,
          y: 40,
          fontSize: 36,
          fontWeight: 'bold',
          color: '#ffffff',
          fontFamily: 'Arial, sans-serif',
        },
        {
          type: 'text',
          content: 'We have something special for {{company}}',
          x: 30,
          y: 100,
          fontSize: 20,
          color: '#c7d2fe',
          fontFamily: 'Arial, sans-serif',
        },
      ],
    },
    {
      name: 'Personalized CTA Card',
      width: 600,
      height: 315,
      background_color: '#f8fafc',
      layers: [
        {
          type: 'shape',
          shape: 'rectangle',
          x: 0,
          y: 0,
          width: 600,
          height: 80,
          fill: '#0f172a',
        },
        {
          type: 'text',
          content: 'Built for {{company}}',
          x: 300,
          y: 18,
          width: 600,
          fontSize: 28,
          fontWeight: 'bold',
          color: '#ffffff',
          align: 'center',
          fontFamily: 'Arial, sans-serif',
        },
        {
          type: 'text',
          content: '{{first_name}}, see how we can help your team',
          x: 300,
          y: 130,
          width: 600,
          fontSize: 22,
          color: '#334155',
          align: 'center',
          fontFamily: 'Arial, sans-serif',
        },
        {
          type: 'shape',
          shape: 'rectangle',
          x: 200,
          y: 220,
          width: 200,
          height: 50,
          fill: '#4F46E5',
          borderRadius: 12,
        },
        {
          type: 'text',
          content: 'Learn More',
          x: 300,
          y: 230,
          width: 200,
          fontSize: 18,
          fontWeight: 'bold',
          color: '#ffffff',
          align: 'center',
          fontFamily: 'Arial, sans-serif',
        },
      ],
    },
  ];
}

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetApi } from '../../api/asset.api';
import type { AssetTemplate, AssetTemplateLayer, CreateAssetTemplateInput } from '@lemlist/shared';
import {
  Image,
  Plus,
  Trash2,
  Copy,
  Eye,
  Layers,
  Type,
  Square,
  ImageIcon,
  Palette,
  RefreshCw,
  Save,
  X,
  Wand2,
  Code,
  ChevronRight,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import toast from 'react-hot-toast';

const MERGE_TAGS = ['{{first_name}}', '{{last_name}}', '{{email}}', '{{company}}', '{{title}}'];

function SvgPreview({ template, params }: { template: { width: number; height: number; background_color: string; layers: AssetTemplateLayer[] }; params: Record<string, string> }) {
  const interpolate = (text: string) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] || `{{${key}}}`);

  return (
    <svg
      viewBox={`0 0 ${template.width} ${template.height}`}
      className="w-full h-auto rounded-lg border border-subtle"
      style={{ maxHeight: 400 }}
    >
      <rect width={template.width} height={template.height} fill={template.background_color} />
      {template.layers.map((layer, i) => {
        if (layer.type === 'text') {
          const text = interpolate(layer.content || '');
          const fontSize = layer.fontSize || 24;
          const anchor = layer.align === 'center' ? 'middle' : layer.align === 'right' ? 'end' : 'start';
          const x = layer.align === 'center'
            ? layer.x + (layer.width || 0) / 2
            : layer.align === 'right'
              ? layer.x + (layer.width || 0)
              : layer.x;
          return (
            <text
              key={i}
              x={x}
              y={layer.y + fontSize}
              fontFamily={layer.fontFamily || 'Arial, sans-serif'}
              fontSize={fontSize}
              fontWeight={layer.fontWeight || 'normal'}
              fill={layer.color || '#000000'}
              textAnchor={anchor}
            >
              {text}
            </text>
          );
        }
        if (layer.type === 'shape') {
          if (layer.shape === 'circle') {
            const cx = layer.x + (layer.width || 0) / 2;
            const cy = layer.y + (layer.height || 0) / 2;
            const r = Math.min(layer.width || 0, layer.height || 0) / 2;
            return <circle key={i} cx={cx} cy={cy} r={r} fill={layer.fill || '#e5e7eb'} opacity={layer.opacity ?? 1} />;
          }
          return (
            <rect
              key={i}
              x={layer.x}
              y={layer.y}
              width={layer.width || 0}
              height={layer.height || 0}
              rx={layer.borderRadius || 0}
              fill={layer.fill || '#e5e7eb'}
              opacity={layer.opacity ?? 1}
            />
          );
        }
        if (layer.type === 'image' && layer.src) {
          return (
            <image
              key={i}
              href={layer.src}
              x={layer.x}
              y={layer.y}
              width={layer.width || 100}
              height={layer.height || 100}
            />
          );
        }
        return null;
      })}
    </svg>
  );
}

export function AssetBuilderPage() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [selectedTemplate, setSelectedTemplate] = useState<AssetTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editName, setEditName] = useState('');
  const [editWidth, setEditWidth] = useState(600);
  const [editHeight, setEditHeight] = useState(315);
  const [editBg, setEditBg] = useState('#ffffff');
  const [editLayers, setEditLayers] = useState<AssetTemplateLayer[]>([]);
  const [previewParams, setPreviewParams] = useState<Record<string, string>>({
    first_name: 'Jane',
    last_name: 'Smith',
    company: 'Acme Corp',
    email: 'jane@acme.com',
    title: 'Head of Growth',
  });

  const { data: templates, isLoading } = useQuery({
    queryKey: ['asset-templates'],
    queryFn: assetApi.listTemplates,
  });

  const { data: presets } = useQuery({
    queryKey: ['asset-presets'],
    queryFn: assetApi.getPresets,
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateAssetTemplateInput) => assetApi.createTemplate(input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['asset-templates'] });
      toast.success('Template created');
      setSelectedTemplate(data);
      setIsCreating(false);
    },
    onError: () => toast.error('Failed to create template'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CreateAssetTemplateInput> }) =>
      assetApi.updateTemplate(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-templates'] });
      toast.success('Template saved');
    },
    onError: () => toast.error('Failed to save'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => assetApi.deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-templates'] });
      toast.success('Template deleted');
      setSelectedTemplate(null);
    },
  });

  function startNew(preset?: CreateAssetTemplateInput) {
    setIsCreating(true);
    setSelectedTemplate(null);
    setEditName(preset?.name || 'New Template');
    setEditWidth(preset?.width || 600);
    setEditHeight(preset?.height || 315);
    setEditBg(preset?.background_color || '#ffffff');
    setEditLayers(preset?.layers || []);
  }

  function openTemplate(t: AssetTemplate) {
    setSelectedTemplate(t);
    setIsCreating(false);
    setEditName(t.name);
    setEditWidth(t.width);
    setEditHeight(t.height);
    setEditBg(t.background_color);
    setEditLayers([...t.layers]);
  }

  function addLayer(type: AssetTemplateLayer['type']) {
    const base: AssetTemplateLayer = { type, x: 20, y: 20 };
    if (type === 'text') {
      Object.assign(base, { content: 'Hello {{first_name}}!', fontSize: 24, color: '#000000', fontFamily: 'Arial, sans-serif' });
    } else if (type === 'shape') {
      Object.assign(base, { shape: 'rectangle', width: 200, height: 60, fill: '#e5e7eb', borderRadius: 8 });
    } else if (type === 'image') {
      Object.assign(base, { width: 100, height: 100, src: '' });
    }
    setEditLayers([...editLayers, base]);
  }

  function updateLayer(index: number, updates: Partial<AssetTemplateLayer>) {
    const next = [...editLayers];
    next[index] = { ...next[index], ...updates };
    setEditLayers(next);
  }

  function removeLayer(index: number) {
    setEditLayers(editLayers.filter((_, i) => i !== index));
  }

  function handleSave() {
    const input: CreateAssetTemplateInput = {
      name: editName,
      width: editWidth,
      height: editHeight,
      background_color: editBg,
      layers: editLayers,
    };
    if (selectedTemplate) {
      updateMutation.mutate({ id: selectedTemplate.id, input });
    } else {
      createMutation.mutate(input);
    }
  }

  const isEditing = isCreating || selectedTemplate;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-sm">
            <Image className="h-5 w-5 text-[var(--text-primary)]" />
          </div>
          <div>
            <h1 className="text-[18px] font-semibold text-[var(--text-primary)]">Dynamic Assets</h1>
            <p className="text-sm text-[var(--text-secondary)]">Build personalized images for email campaigns</p>
          </div>
        </div>
        <button
          onClick={() => startNew()}
          className="btn-primary flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all shadow-sm"
        >
          <Plus className="h-4 w-4" />
          New Template
        </button>
      </div>

      {/* Presets */}
      {!isEditing && presets && presets.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3 flex items-center gap-2">
            <Wand2 className="h-4 w-4" />
            Quick Start from Preset
          </h3>
          <div className="grid grid-cols-2 gap-4">
            {presets.map((preset, i) => (
              <button
                key={i}
                onClick={() => startNew(preset)}
                className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4 text-left hover:border-[var(--border-default)] hover:bg-[var(--bg-elevated)] transition-all group"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-[var(--text-primary)]">{preset.name}</span>
                  <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] transition-colors" />
                </div>
                <div className="rounded-lg overflow-hidden border border-[var(--border-subtle)]">
                  <SvgPreview
                    template={{
                      width: preset.width || 600,
                      height: preset.height || 315,
                      background_color: preset.background_color || '#ffffff',
                      layers: preset.layers || [],
                    }}
                    params={previewParams}
                  />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Template List */}
      {!isEditing && (
        <>
          <h3 className="text-sm font-medium text-[var(--text-secondary)] flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Your Templates
          </h3>
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-transparent" />
            </div>
          ) : !templates || templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--bg-surface)] mb-4">
                <Image className="h-8 w-8 text-[var(--text-tertiary)]" />
              </div>
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-1">No templates yet</h3>
              <p className="text-sm text-[var(--text-secondary)] mb-4">Create your first personalized image template or start from a preset.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map((t) => (
                <div
                  key={t.id}
                  className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden hover:border-[var(--border-default)] transition-colors group cursor-pointer"
                  onClick={() => openTemplate(t)}
                >
                  <div className="p-3">
                    <SvgPreview
                      template={t}
                      params={previewParams}
                    />
                  </div>
                  <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-3">
                    <div>
                      <h4 className="text-sm font-medium text-[var(--text-primary)]">{t.name}</h4>
                      <p className="text-xs text-[var(--text-tertiary)]">{t.width}x{t.height}</p>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          confirm(
                            { title: `Delete "${t.name}"?`, body: 'Emails already sent keep the images they were built with.', tone: 'danger' },
                            () => deleteMutation.mutate(t.id),
                          );
                        }}
                        className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Editor */}
      {isEditing && (
        <div className="grid grid-cols-5 gap-4">
          {/* Preview Panel */}
          <div className="col-span-3 space-y-4">
            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
                  <Eye className="h-4 w-4 text-[var(--text-secondary)]" />
                  Live Preview
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="btn-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save
                  </button>
                  <button
                    onClick={() => { setIsCreating(false); setSelectedTemplate(null); }}
                    className="flex items-center gap-1.5 rounded-lg bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                    Close
                  </button>
                </div>
              </div>
              <SvgPreview
                template={{
                  width: editWidth,
                  height: editHeight,
                  background_color: editBg,
                  layers: editLayers,
                }}
                params={previewParams}
              />
            </div>

            {/* Preview Variables */}
            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
                <Code className="h-4 w-4 text-[var(--text-secondary)]" />
                Test Variables
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {Object.entries(previewParams).map(([key, value]) => (
                  <div key={key}>
                    <label className="text-xs text-[var(--text-tertiary)] mb-1 block">{`{{${key}}}`}</label>
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => setPreviewParams({ ...previewParams, [key]: e.target.value })}
                      className="w-full rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-default)]"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Settings Panel */}
          <div className="col-span-2 space-y-4">
            {/* Template Settings */}
            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4 space-y-3">
              <h3 className="text-sm font-medium text-[var(--text-primary)]">Template Settings</h3>
              <div>
                <label className="text-xs text-[var(--text-tertiary)] mb-1 block">Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-default)]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--text-tertiary)] mb-1 block">Width</label>
                  <input
                    type="number"
                    value={editWidth}
                    onChange={(e) => setEditWidth(Number(e.target.value))}
                    className="w-full rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-default)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-tertiary)] mb-1 block">Height</label>
                  <input
                    type="number"
                    value={editHeight}
                    onChange={(e) => setEditHeight(Number(e.target.value))}
                    className="w-full rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-default)]"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--text-tertiary)] mb-1 block">Background</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={editBg}
                    onChange={(e) => setEditBg(e.target.value)}
                    className="h-9 w-12 rounded-lg border border-[var(--border-subtle)] cursor-pointer"
                  />
                  <input
                    type="text"
                    value={editBg}
                    onChange={(e) => setEditBg(e.target.value)}
                    className="flex-1 rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-default)]"
                  />
                </div>
              </div>
            </div>

            {/* Layers */}
            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
                  <Layers className="h-4 w-4 text-[var(--text-secondary)]" />
                  Layers ({editLayers.length})
                </h3>
                <div className="flex gap-1">
                  <button
                    onClick={() => addLayer('text')}
                    className="p-1.5 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors"
                    title="Add text"
                  >
                    <Type className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => addLayer('shape')}
                    className="p-1.5 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors"
                    title="Add shape"
                  >
                    <Square className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => addLayer('image')}
                    className="p-1.5 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors"
                    title="Add image"
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {editLayers.length === 0 && (
                  <p className="text-xs text-[var(--text-tertiary)] text-center py-4">
                    No layers yet. Add text, shapes, or images above.
                  </p>
                )}
                {editLayers.map((layer, i) => (
                  <div key={i} className="rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[var(--text-secondary)] flex items-center gap-1.5">
                        {layer.type === 'text' && <Type className="h-3 w-3 text-[var(--text-primary)]" />}
                        {layer.type === 'shape' && <Square className="h-3 w-3 text-[var(--text-primary)]" />}
                        {layer.type === 'image' && <ImageIcon className="h-3 w-3 text-[var(--text-primary)]" />}
                        {layer.type.charAt(0).toUpperCase() + layer.type.slice(1)} {i + 1}
                      </span>
                      <button
                        onClick={() => removeLayer(i)}
                        className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Position */}
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <label className="text-[10px] text-[var(--text-tertiary)]">X</label>
                        <input type="number" value={layer.x} onChange={(e) => updateLayer(i, { x: Number(e.target.value) })} className="w-full rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-primary)]" />
                      </div>
                      <div>
                        <label className="text-[10px] text-[var(--text-tertiary)]">Y</label>
                        <input type="number" value={layer.y} onChange={(e) => updateLayer(i, { y: Number(e.target.value) })} className="w-full rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-primary)]" />
                      </div>
                      <div>
                        <label className="text-[10px] text-[var(--text-tertiary)]">W</label>
                        <input type="number" value={layer.width || ''} onChange={(e) => updateLayer(i, { width: Number(e.target.value) })} className="w-full rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-primary)]" />
                      </div>
                      <div>
                        <label className="text-[10px] text-[var(--text-tertiary)]">H</label>
                        <input type="number" value={layer.height || ''} onChange={(e) => updateLayer(i, { height: Number(e.target.value) })} className="w-full rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-primary)]" />
                      </div>
                    </div>

                    {/* Type-specific fields */}
                    {layer.type === 'text' && (
                      <>
                        <div>
                          <label className="text-[10px] text-[var(--text-tertiary)]">Content</label>
                          <input type="text" value={layer.content || ''} onChange={(e) => updateLayer(i, { content: e.target.value })} className="w-full rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-primary)]" />
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {MERGE_TAGS.map((tag) => (
                              <button
                                key={tag}
                                onClick={() => updateLayer(i, { content: (layer.content || '') + ' ' + tag })}
                                className="rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-[10px] text-[var(--text-tertiary)]">Size</label>
                            <input type="number" value={layer.fontSize || 24} onChange={(e) => updateLayer(i, { fontSize: Number(e.target.value) })} className="w-full rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-primary)]" />
                          </div>
                          <div>
                            <label className="text-[10px] text-[var(--text-tertiary)]">Weight</label>
                            <select value={layer.fontWeight || 'normal'} onChange={(e) => updateLayer(i, { fontWeight: e.target.value })} className="w-full rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-primary)]">
                              <option value="normal">Normal</option>
                              <option value="bold">Bold</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-[var(--text-tertiary)]">Align</label>
                            <select value={layer.align || 'left'} onChange={(e) => updateLayer(i, { align: e.target.value as 'left' | 'center' | 'right' })} className="w-full rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-primary)]">
                              <option value="left">Left</option>
                              <option value="center">Center</option>
                              <option value="right">Right</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-[var(--text-tertiary)]">Color</label>
                          <div className="flex gap-2">
                            <input type="color" value={layer.color || '#000000'} onChange={(e) => updateLayer(i, { color: e.target.value })} className="h-7 w-8 rounded border border-[var(--border-subtle)] cursor-pointer" />
                            <input type="text" value={layer.color || '#000000'} onChange={(e) => updateLayer(i, { color: e.target.value })} className="flex-1 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-primary)]" />
                          </div>
                        </div>
                      </>
                    )}

                    {layer.type === 'shape' && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-[var(--text-tertiary)]">Shape</label>
                            <select value={layer.shape || 'rectangle'} onChange={(e) => updateLayer(i, { shape: e.target.value as 'rectangle' | 'circle' })} className="w-full rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-primary)]">
                              <option value="rectangle">Rectangle</option>
                              <option value="circle">Circle</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-[var(--text-tertiary)]">Radius</label>
                            <input type="number" value={layer.borderRadius || 0} onChange={(e) => updateLayer(i, { borderRadius: Number(e.target.value) })} className="w-full rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-primary)]" />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-[var(--text-tertiary)]">Fill</label>
                          <div className="flex gap-2">
                            <input type="color" value={layer.fill || '#e5e7eb'} onChange={(e) => updateLayer(i, { fill: e.target.value })} className="h-7 w-8 rounded border border-[var(--border-subtle)] cursor-pointer" />
                            <input type="text" value={layer.fill || '#e5e7eb'} onChange={(e) => updateLayer(i, { fill: e.target.value })} className="flex-1 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-primary)]" />
                          </div>
                        </div>
                      </>
                    )}

                    {layer.type === 'image' && (
                      <div>
                        <label className="text-[10px] text-[var(--text-tertiary)]">Image URL</label>
                        <input type="text" value={layer.src || ''} onChange={(e) => updateLayer(i, { src: e.target.value })} placeholder="https://..." className="w-full rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-primary)]" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

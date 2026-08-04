/**
 * Third-party integrations — Slack, Discord, Telegram, Zapier, Make,
 * HubSpot, Pipedrive. Each user can connect one instance of each provider;
 * connected providers receive events from the same bus that powers webhooks.
 */

export type IntegrationProviderId =
  | 'slack'
  | 'discord'
  | 'telegram'
  | 'zapier'
  | 'make'
  | 'hubspot'
  | 'pipedrive';

export type IntegrationKind = 'notification' | 'automation' | 'crm';

/** One field the user must fill in to connect a provider. */
export interface IntegrationConfigField {
  key: string;
  label: string;
  placeholder: string;
  /** Secrets are write-only: redacted in API responses, empty on edit = keep. */
  secret: boolean;
  help?: string;
}

/** Static catalog entry describing a provider (shipped to the client). */
export interface IntegrationProviderMeta {
  id: IntegrationProviderId;
  name: string;
  kind: IntegrationKind;
  description: string;
  /** Step-by-step "where do I get this credential" guide. */
  setupSteps: string[];
  /** Link to the provider's own docs for obtaining the credential. */
  docsUrl: string;
  fields: IntegrationConfigField[];
  /** Events this provider can react to. */
  supportedEvents: string[];
  /** Events pre-selected when connecting. */
  defaultEvents: string[];
}

export interface UserIntegration {
  id: string;
  user_id: string;
  provider: IntegrationProviderId;
  /** Redacted before leaving the server — secrets become masked previews. */
  config: Record<string, string>;
  events: string[];
  is_active: boolean;
  last_success_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectIntegrationInput {
  config: Record<string, string>;
  events?: string[];
}

export interface UpdateIntegrationInput {
  config?: Record<string, string>;
  events?: string[];
  is_active?: boolean;
}

export interface IntegrationActivity {
  id: string;
  integration_id: string;
  event_type: string;
  summary: string;
  success: boolean;
  detail: string | null;
  created_at: string;
}

export interface IntegrationTestResult {
  success: boolean;
  detail: string;
}

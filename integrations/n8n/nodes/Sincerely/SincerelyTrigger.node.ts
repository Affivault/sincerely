import { createHmac, timingSafeEqual } from 'crypto';
import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IHookFunctions,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
	type ILoadOptionsFunctions,
	type INodePropertyOptions,
} from 'n8n-workflow';
import { sincerelyError, sincerelyRequest, sincerelyRequestAll } from './GenericFunctions';

/** The v1 events a webhook can subscribe to. Keep in step with PUBLIC_EVENTS in the Sincerely API. */
export const EVENTS: INodePropertyOptions[] = [
	{ name: 'Campaign Completed', value: 'campaign.completed', description: 'Every contact in a campaign has finished its sequence' },
	{ name: 'Campaign Paused', value: 'campaign.paused', description: 'A campaign was paused, by a person or the deliverability autopilot' },
	{ name: 'Contact Created', value: 'contact.created', description: 'A contact was added, by hand, import, the Prospector, the API or an integration' },
	{ name: 'Contact Unsubscribed', value: 'contact.unsubscribed', description: 'A contact unsubscribed, by the link or a reply Relay read as one' },
	{ name: 'Contact Updated', value: 'contact.updated', description: "A contact's details changed" },
	{ name: 'Email Bounced', value: 'email.bounced', description: 'A campaign email bounced' },
	{ name: 'Email Opened', value: 'email.opened', description: 'A campaign email was opened' },
	{ name: 'Email Sent', value: 'email.sent', description: 'A campaign email went out. Can be a lot of executions on a busy account.' },
	{ name: 'Interested Reply', value: 'reply.interested', description: 'Relay read a reply as interested or asking for a meeting' },
	{ name: 'Link Clicked', value: 'email.clicked', description: 'A link in a campaign email was clicked' },
	{ name: 'Reply Classified', value: 'reply.classified', description: 'Relay read a reply, whatever it found' },
	{ name: 'Reply Received', value: 'reply.received', description: 'A contact replied to a campaign email (auto-replies are left out)' },
];

/** Deliveries carry Sincerely-Signature: t=<unix seconds>,v1=<HMAC-SHA256 of "t.body">. */
export function verifySignature(secret: string, rawBody: string, header: string, now = Math.floor(Date.now() / 1000), tolerance = 300): boolean {
	const parts: Record<string, string> = {};
	for (const piece of String(header || '').split(',')) {
		const at = piece.indexOf('=');
		if (at > 0) parts[piece.slice(0, at).trim()] = piece.slice(at + 1).trim();
	}
	const t = Number(parts.t);
	if (!Number.isInteger(t) || !parts.v1 || Math.abs(now - t) > tolerance) return false;
	const want = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'), 'hex');
	const got = Buffer.from(parts.v1, 'hex');
	return want.length === got.length && timingSafeEqual(want, got);
}

export class SincerelyTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sincerely Trigger',
		name: 'sincerelyTrigger',
		icon: { light: 'file:../../icons/sincerely.svg', dark: 'file:../../icons/sincerely.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow the moment something happens in Sincerely: an interested reply, a new contact, an unsubscribe and more',
		defaults: { name: 'Sincerely Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'sincerelyApi', required: true }],
		webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['reply.interested'],
				description: 'What starts the workflow',
				options: EVENTS,
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Only for Campaign Name or ID',
						name: 'campaignId',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getCampaigns' },
						default: '',
						description:
							'Only events from this campaign. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getCampaigns(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const campaigns = await sincerelyRequestAll.call(this, '/campaigns', {}, 1000);
				return campaigns.map((c) => ({ name: `${c.name} (${c.status})`, value: c.id as string }));
			},
		},
	};

	webhookMethods = {
		default: {
			/** Is the webhook this workflow made still there, at this URL, for these events? */
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (!data.webhookId) return false;
				try {
					const hook = await sincerelyRequest.call(this, 'GET', `/webhooks/${encodeURIComponent(data.webhookId as string)}`);
					const events = (this.getNodeParameter('events') as string[]).slice().sort();
					const same =
						hook.url === this.getNodeWebhookUrl('default') &&
						hook.active === true &&
						JSON.stringify(((hook.events as string[]) ?? []).slice().sort()) === JSON.stringify(events);
					if (!same) {
						// Changed in n8n or switched off in Sincerely: let create() make a fresh one.
						await sincerelyRequest.call(this, 'DELETE', `/webhooks/${encodeURIComponent(data.webhookId as string)}`).catch(() => undefined);
						delete data.webhookId;
						delete data.webhookSecret;
						return false;
					}
					return true;
				} catch (error) {
					if (sincerelyError((error as { cause?: unknown }).cause ?? error).status === 404 || /404/.test(String((error as IDataObject).httpCode ?? ''))) {
						delete data.webhookId;
						delete data.webhookSecret;
						return false;
					}
					throw new NodeOperationError(this.getNode(), error as Error, { description: (error as NodeApiError).description ?? undefined });
				}
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const hook = await sincerelyRequest.call(this, 'POST', '/webhooks', {
					url: this.getNodeWebhookUrl('default'),
					events: this.getNodeParameter('events') as string[],
					description: `n8n: ${this.getWorkflow().name ?? 'workflow'}`.slice(0, 200),
				});
				const data = this.getWorkflowStaticData('node');
				data.webhookId = hook.id;
				data.webhookSecret = hook.secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (data.webhookId) {
					try {
						await sincerelyRequest.call(this, 'DELETE', `/webhooks/${encodeURIComponent(data.webhookId as string)}`);
					} catch (error) {
						// Already gone is fine; anything else means the webhook may still exist.
						const status = sincerelyError((error as { cause?: unknown }).cause ?? error).status ?? Number((error as IDataObject).httpCode);
						if (status !== 404) return false;
					}
				}
				delete data.webhookId;
				delete data.webhookSecret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const body = this.getBodyData() as IDataObject;
		const secret = this.getWorkflowStaticData('node').webhookSecret as string | undefined;
		const raw = (req as unknown as { rawBody?: Buffer | string }).rawBody;

		// Only Sincerely can sign with this webhook's secret: anything else posted to the URL is turned away.
		if (secret && raw !== undefined) {
			const header = String(this.getHeaderData()['sincerely-signature'] ?? '');
			if (!verifySignature(secret, Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw), header)) {
				const res = this.getResponseObject();
				res.status(401).json({ error: 'Invalid Sincerely signature' });
				return { noWebhookResponse: true };
			}
		}

		const events = this.getNodeParameter('events') as string[];
		if (!body || typeof body.type !== 'string' || !events.includes(body.type)) return {};
		const only = (this.getNodeParameter('options', {}) as IDataObject).campaignId as string | undefined;
		const campaign = (body.data as IDataObject | undefined)?.campaign as IDataObject | undefined;
		if (only && campaign?.id !== only) return {};

		return { workflowData: [this.helpers.returnJsonArray([body])] };
	}
}

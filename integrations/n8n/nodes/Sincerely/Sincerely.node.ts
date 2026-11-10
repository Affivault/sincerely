import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeExecutionData,
	type INodePropertyOptions,
	type INodeProperties,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';
import { contactPath, sincerelyRequest, sincerelyRequestAll } from './GenericFunctions';

/* ── Shared fields ────────────────────────────────────────────────────── */

const show = (resource: string, operation: string[]) => ({ show: { resource: [resource], operation } });

const CONTACT_FIELDS: INodeProperties[] = [
	{ displayName: 'City', name: 'city', type: 'string', default: '' },
	{ displayName: 'Company', name: 'company', type: 'string', default: '' },
	{ displayName: 'Country', name: 'country', type: 'string', default: '' },
	{
		displayName: 'Custom Fields',
		name: 'customFields',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Add Custom Field',
		description: 'Your own fields. Merged with any the contact already has.',
		options: [
			{
				name: 'field',
				displayName: 'Field',
				values: [
					{ displayName: 'Name', name: 'key', type: 'string', default: '' },
					{ displayName: 'Value', name: 'value', type: 'string', default: '' },
				],
			},
		],
	},
	{ displayName: 'First Name', name: 'first_name', type: 'string', default: '' },
	{ displayName: 'Industry', name: 'industry', type: 'string', default: '' },
	{ displayName: 'Job Title', name: 'job_title', type: 'string', default: '' },
	{ displayName: 'Last Name', name: 'last_name', type: 'string', default: '' },
	{ displayName: 'LinkedIn URL', name: 'linkedin_url', type: 'string', default: '' },
	{ displayName: 'Location', name: 'location', type: 'string', default: '', description: 'Free text, for example "London, United Kingdom"' },
	{ displayName: 'Phone', name: 'phone', type: 'string', default: '' },
	{ displayName: 'State or Region', name: 'state', type: 'string', default: '' },
	{
		displayName: 'Tags',
		name: 'tags',
		type: 'string',
		default: '',
		description: 'Tag names, comma-separated. New ones are created. On an existing contact this replaces their tags.',
	},
	{ displayName: 'Website', name: 'website', type: 'string', default: '' },
];

const LIFECYCLE: INodeProperties = {
	displayName: 'Lifecycle',
	name: 'lifecycle',
	type: 'options',
	default: 'lead',
	description: 'New contacts are leads unless you choose otherwise',
	options: [
		{ name: 'Lead', value: 'lead', description: 'Someone you are prospecting' },
		{ name: 'Contact', value: 'contact', description: 'A relationship' },
		{ name: 'Customer', value: 'customer' },
	],
};

const LIST_SELECT = (name: string, displayName: string, required: boolean): INodeProperties => ({
	displayName: `${displayName} Name or ID`,
	name,
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getLists' },
	required,
	default: '',
	description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
});

const CAMPAIGN_SELECT = (resource: string, operations: string[]): INodeProperties => ({
	displayName: 'Campaign Name or ID',
	name: 'campaignId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getCampaigns' },
	required: true,
	default: '',
	description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	displayOptions: show(resource, operations),
});

const EMAIL = (resource: string, operations: string[], description?: string): INodeProperties => ({
	displayName: 'Email',
	name: 'email',
	type: 'string',
	placeholder: 'name@email.com',
	required: true,
	default: '',
	description,
	displayOptions: show(resource, operations),
});

const RETURN_ALL = (resource: string): INodeProperties[] => [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: show(resource, ['getAll']),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: [resource], operation: ['getAll'], returnAll: [false] } },
	},
];

/* ── Building request bodies ─────────────────────────────────────────── */

/** Only what was filled in: an empty field never clears anything in Sincerely. */
export function contactBody(email: string, fields: IDataObject): IDataObject {
	const body: IDataObject = { email: String(email).trim() };
	for (const [key, value] of Object.entries(fields)) {
		if (key === 'customFields' || key === 'tags' || key === 'listId') continue;
		if (value === undefined || value === null || String(value).trim() === '') continue;
		body[key] = typeof value === 'string' ? value.trim() : value;
	}
	if (typeof fields.tags === 'string' && fields.tags.trim()) {
		body.tags = [...new Set(fields.tags.split(',').map((t) => t.trim()).filter(Boolean))].slice(0, 20);
	}
	const rows = ((fields.customFields as IDataObject | undefined)?.field as IDataObject[] | undefined) ?? [];
	const custom: IDataObject = {};
	for (const row of rows) {
		const k = String(row.key ?? '').trim();
		const v = String(row.value ?? '').trim();
		if (k && v) custom[k] = v;
	}
	if (Object.keys(custom).length) body.custom_fields = custom;
	return body;
}

export class Sincerely implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sincerely',
		name: 'sincerely',
		icon: { light: 'file:../../icons/sincerely.svg', dark: 'file:../../icons/sincerely.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Add contacts, put people into cold email campaigns, unsubscribe them, and read replies in Sincerely',
		defaults: { name: 'Sincerely' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'sincerelyApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Campaign', value: 'campaign' },
					{ name: 'Contact', value: 'contact' },
					{ name: 'List', value: 'list' },
					{ name: 'Reply', value: 'reply' },
				],
				default: 'contact',
			},

			// Contact
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['contact'] } },
				options: [
					{ name: 'Create or Update', value: 'upsert', description: 'Create a new record, or update the current one if it already exists (upsert)', action: 'Create or update a contact' },
					{ name: 'Delete', value: 'delete', description: 'Delete a contact', action: 'Delete a contact' },
					{ name: 'Get', value: 'get', description: 'Get a contact by email or ID', action: 'Get a contact' },
					{ name: 'Get Many', value: 'getAll', description: 'Find contacts', action: 'Get many contacts' },
					{ name: 'Unsubscribe', value: 'unsubscribe', description: 'Stop every campaign emailing an address', action: 'Unsubscribe an email address' },
				],
				default: 'upsert',
			},
			EMAIL('contact', ['upsert'], 'One contact per address'),
			{
				displayName: 'Update Existing Contact',
				name: 'updateExisting',
				type: 'boolean',
				default: true,
				description: 'Whether to update the contact if the email is already in Sincerely. When off, the step fails instead.',
				displayOptions: show('contact', ['upsert']),
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: show('contact', ['upsert']),
				options: [...CONTACT_FIELDS, LIFECYCLE, LIST_SELECT('listId', 'Add to List', false)].sort((a, b) => a.displayName.localeCompare(b.displayName)),
			},
			{
				displayName: 'Email or ID',
				name: 'contactId',
				type: 'string',
				required: true,
				default: '',
				description: "The contact's email address, or its ID",
				displayOptions: show('contact', ['get', 'delete']),
			},
			EMAIL('contact', ['unsubscribe'], 'Works whether or not the address is a contact yet'),
			...RETURN_ALL('contact'),
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: show('contact', ['getAll']),
				options: [
					{ displayName: 'Changed After', name: 'updated_after', type: 'dateTime', default: '', description: 'For syncing: the time of your last run' },
					{ displayName: 'Email', name: 'email', type: 'string', placeholder: 'name@email.com', default: '' },
					{ ...LIFECYCLE, default: '' , options: [{ name: 'Any', value: '' }, ...(LIFECYCLE.options as INodePropertyOptions[])] },
					LIST_SELECT('list_id', 'List', false),
					{ displayName: 'Search', name: 'q', type: 'string', default: '', description: 'Words to find in name, email and company' },
					{ displayName: 'Tag', name: 'tag', type: 'string', default: '' },
				],
			},

			// Campaign
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['campaign'] } },
				options: [
					{ name: 'Add Contact', value: 'addContact', description: "Put a person into a campaign's sequence", action: 'Add a contact to a campaign' },
					{ name: 'Get', value: 'get', description: 'Get a campaign with its totals', action: 'Get a campaign' },
					{ name: 'Get Many', value: 'getAll', description: 'List campaigns', action: 'Get many campaigns' },
					{ name: 'Pause', value: 'pause', description: 'Stop a campaign sending', action: 'Pause a campaign' },
					{ name: 'Remove Contact', value: 'removeContact', description: 'Take a person out of a campaign', action: 'Remove a contact from a campaign' },
					{ name: 'Resume', value: 'resume', description: 'Start a paused campaign again', action: 'Resume a campaign' },
				],
				default: 'addContact',
			},
			CAMPAIGN_SELECT('campaign', ['addContact', 'removeContact', 'get', 'pause', 'resume']),
			EMAIL('campaign', ['addContact', 'removeContact']),
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				description: 'Created or filled in on the contact before they are added',
				displayOptions: show('campaign', ['addContact']),
				options: CONTACT_FIELDS,
			},
			...RETURN_ALL('campaign'),
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: show('campaign', ['getAll']),
				options: [
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						default: 'running',
						options: ['cancelled', 'completed', 'draft', 'paused', 'running', 'scheduled'].map((v) => ({ name: v[0].toUpperCase() + v.slice(1), value: v })),
					},
				],
			},

			// List
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['list'] } },
				options: [
					{ name: 'Add Contact', value: 'addContact', description: 'Add a person to a list', action: 'Add a contact to a list' },
					{ name: 'Get Many', value: 'getAll', description: 'List your lists', action: 'Get many lists' },
					{ name: 'Remove Contact', value: 'removeContact', description: 'Take a person out of a list', action: 'Remove a contact from a list' },
				],
				default: 'addContact',
			},
			{ ...LIST_SELECT('listId', 'List', true), displayOptions: show('list', ['addContact', 'removeContact']) },
			EMAIL('list', ['addContact', 'removeContact'], 'A new address is created as a contact'),
			...RETURN_ALL('list'),

			// Reply
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['reply'] } },
				options: [{ name: 'Get Many', value: 'getAll', description: 'Find replies, with what Relay read in each', action: 'Get many replies' }],
				default: 'getAll',
			},
			...RETURN_ALL('reply'),
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: show('reply', ['getAll']),
				options: [
					{
						displayName: 'Campaign Name or ID',
						name: 'campaign_id',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getCampaigns' },
						default: '',
						description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					},
					{
						displayName: 'Intent',
						name: 'intent',
						type: 'options',
						default: 'interested',
						options: ['interested', 'meeting', 'not_now', 'objection', 'other', 'out_of_office', 'unsubscribe'].map((v) => ({
							name: v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
							value: v,
						})),
					},
					{ displayName: 'Received After', name: 'after', type: 'dateTime', default: '' },
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getLists(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const lists = await sincerelyRequestAll.call(this, '/lists', {}, 1000);
				return lists.map((l) => ({ name: `${l.name} (${l.kind} list, ${l.contact_count})`, value: l.id as string }));
			},
			async getCampaigns(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const campaigns = await sincerelyRequestAll.call(this, '/campaigns', {}, 1000);
				return campaigns.map((c) => ({ name: `${c.name} (${c.status})`, value: c.id as string }));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const results = await run.call(this, resource, operation, i);
				for (const json of results) out.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				// Keep Sincerely's own sentence and reference (the description) when passing it on.
				throw new NodeOperationError(this.getNode(), error as Error, {
					itemIndex: i,
					description: (error as NodeApiError).description ?? undefined,
				});
			}
		}
		return [out];
	}
}

const isEmail = (v: string) => v.includes('@');

async function getMany(this: IExecuteFunctions, path: string, qs: IDataObject, i: number): Promise<IDataObject[]> {
	const returnAll = this.getNodeParameter('returnAll', i) as boolean;
	const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
	return sincerelyRequestAll.call(this, path, qs, limit);
}

/** One operation for one input item. Returns the items it outputs. */
export async function run(this: IExecuteFunctions, resource: string, operation: string, i: number): Promise<IDataObject[]> {
	if (resource === 'contact') {
		if (operation === 'upsert') {
			const fields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
			const body = contactBody(this.getNodeParameter('email', i) as string, fields);
			if (fields.listId) body.list_ids = [fields.listId];
			body.upsert = this.getNodeParameter('updateExisting', i, true) as boolean;
			return [await sincerelyRequest.call(this, 'POST', '/contacts', body)];
		}
		if (operation === 'get') {
			const ref = String(this.getNodeParameter('contactId', i)).trim();
			if (isEmail(ref)) {
				const found = await sincerelyRequestAll.call(this, '/contacts', { email: ref }, 1);
				if (!found.length) throw new NodeOperationError(this.getNode(), `There is no contact with the address ${ref}`, { itemIndex: i });
				return found;
			}
			return [await sincerelyRequest.call(this, 'GET', `/contacts/${contactPath(ref)}`)];
		}
		if (operation === 'delete') {
			let ref = String(this.getNodeParameter('contactId', i)).trim();
			if (isEmail(ref)) {
				const found = await sincerelyRequestAll.call(this, '/contacts', { email: ref }, 1);
				if (!found.length) throw new NodeOperationError(this.getNode(), `There is no contact with the address ${ref}`, { itemIndex: i });
				ref = found[0].id as string;
			}
			return [await sincerelyRequest.call(this, 'DELETE', `/contacts/${contactPath(ref)}`)];
		}
		if (operation === 'unsubscribe') {
			return [await sincerelyRequest.call(this, 'POST', '/unsubscribes', { email: String(this.getNodeParameter('email', i)).trim() })];
		}
		if (operation === 'getAll') {
			return getMany.call(this, '/contacts', this.getNodeParameter('filters', i, {}) as IDataObject, i);
		}
	}

	if (resource === 'campaign') {
		if (operation === 'getAll') return getMany.call(this, '/campaigns', this.getNodeParameter('filters', i, {}) as IDataObject, i);
		const campaignId = encodeURIComponent(String(this.getNodeParameter('campaignId', i)));
		if (operation === 'get') return [await sincerelyRequest.call(this, 'GET', `/campaigns/${campaignId}`)];
		if (operation === 'pause' || operation === 'resume') {
			return [await sincerelyRequest.call(this, 'POST', `/campaigns/${campaignId}/${operation}`, {})];
		}
		const email = String(this.getNodeParameter('email', i)).trim();
		if (operation === 'addContact') {
			const fields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
			const r = await sincerelyRequest.call(this, 'POST', `/campaigns/${campaignId}/contacts`, { contacts: [contactBody(email, fields)] });
			// The person's own answer first (added, skipped and why), then the campaign's totals.
			const mine = ((r.results as IDataObject[] | undefined) ?? [])[0] ?? {};
			return [{ ...mine, campaign_id: r.campaign_id, campaign_total: r.total, contact_created: Number(r.created_contacts ?? 0) > 0 }];
		}
		if (operation === 'removeContact') {
			return [await sincerelyRequest.call(this, 'DELETE', `/campaigns/${campaignId}/contacts/${contactPath(email)}`)];
		}
	}

	if (resource === 'list') {
		if (operation === 'getAll') return getMany.call(this, '/lists', {}, i);
		const listId = encodeURIComponent(String(this.getNodeParameter('listId', i)));
		const email = String(this.getNodeParameter('email', i)).trim();
		if (operation === 'addContact') return [await sincerelyRequest.call(this, 'POST', `/lists/${listId}/contacts`, { emails: [email] })];
		if (operation === 'removeContact') return [await sincerelyRequest.call(this, 'DELETE', `/lists/${listId}/contacts/${contactPath(email)}`)];
	}

	if (resource === 'reply' && operation === 'getAll') {
		return getMany.call(this, '/replies', this.getNodeParameter('filters', i, {}) as IDataObject, i);
	}

	throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not known for ${resource}`, { itemIndex: i });
}

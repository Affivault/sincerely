import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

type Context = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions;

/** The API root from the credential's URL, with or without a trailing /v1. */
export function apiRoot(baseUrl: string): string {
	return `${String(baseUrl || 'https://skysend-api.onrender.com')
		.trim()
		.replace(/\/+$/, '')
		.replace(/\/(api\/)?v1$/, '')}/v1`;
}

/** Sincerely answers errors as { error: { code, message }, request_id }. Find that, wherever the HTTP client put it. */
export function sincerelyError(error: unknown): { message?: string; code?: string; requestId?: string; status?: number } {
	const e = error as {
		response?: { status?: number; data?: unknown; body?: unknown };
		cause?: { response?: { status?: number; data?: unknown; body?: unknown } };
		httpCode?: string | number;
		statusCode?: number;
	};
	const res = e?.response ?? e?.cause?.response;
	let data = (res?.data ?? res?.body) as unknown;
	if (typeof data === 'string') {
		try {
			data = JSON.parse(data);
		} catch {
			data = undefined;
		}
	}
	const body = (data ?? {}) as { error?: { message?: string; code?: string }; request_id?: string };
	const status = res?.status ?? e?.statusCode ?? (e?.httpCode !== undefined ? Number(e.httpCode) : undefined);
	return { message: body.error?.message, code: body.error?.code, requestId: body.request_id, status };
}

export async function sincerelyRequest(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<IDataObject> {
	const credentials = await this.getCredentials('sincerelyApi');
	const options: IHttpRequestOptions = {
		method,
		url: `${apiRoot(credentials.baseUrl as string)}${path}`,
		json: true,
		headers: { 'User-Agent': 'n8n (Sincerely node)', Accept: 'application/json' },
	};
	if (body !== undefined) options.body = body;
	if (qs !== undefined) {
		// Empty filters are left out rather than sent blank.
		const clean: IDataObject = {};
		for (const [k, v] of Object.entries(qs)) if (v !== undefined && v !== null && v !== '') clean[k] = v;
		options.qs = clean;
	}
	try {
		return (await this.helpers.httpRequestWithAuthentication.call(this, 'sincerelyApi', options)) as IDataObject;
	} catch (error) {
		const info = sincerelyError(error);
		const message = info.message ?? (error as Error)?.message ?? 'Sincerely answered with an error';
		const description = [
			info.code ? `Code: ${info.code}` : '',
			info.requestId ? `Sincerely reference: ${info.requestId}` : '',
			info.status === 401 ? 'Check the API key in the Sincerely credential, or create a new one in Settings > API & webhooks.' : '',
		]
			.filter(Boolean)
			.join('. ');
		const httpCode = info.status !== undefined ? String(info.status) : undefined;
		// A clean object, not the raw HTTP error: given the response, n8n swaps the
		// description for the response's message and then drops it as a duplicate,
		// losing the code and the reference.
		throw new NodeApiError(this.getNode(), { message, httpCode, description } as JsonObject, {
			message,
			description: description || undefined,
			httpCode,
		});
	}
}

/**
 * Every item of a list endpoint, following Sincerely's cursor, stopping at
 * `limit` when one is given.
 */
export async function sincerelyRequestAll(
	this: Context,
	path: string,
	qs: IDataObject = {},
	limit?: number,
): Promise<IDataObject[]> {
	const out: IDataObject[] = [];
	let cursor: string | undefined;
	for (;;) {
		const pageSize = limit ? Math.min(100, Math.max(1, limit - out.length)) : 100;
		const page = await sincerelyRequest.call(this, 'GET', path, undefined, { ...qs, limit: pageSize, cursor });
		out.push(...(((page.data as IDataObject[]) ?? []) as IDataObject[]));
		if (limit && out.length >= limit) return out.slice(0, limit);
		if (!page.has_more || !page.next_cursor) return out;
		cursor = page.next_cursor as string;
	}
}

/** A contact reference typed by a person: an id, or an email address (which the API also accepts). */
export function contactPath(value: string): string {
	return encodeURIComponent(String(value).trim());
}

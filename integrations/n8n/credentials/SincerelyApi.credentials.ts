import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SincerelyApi implements ICredentialType {
	name = 'sincerelyApi';

	displayName = 'Sincerely API';

	icon: Icon = { light: 'file:../icons/sincerely.svg', dark: 'file:../icons/sincerely.dark.svg' };

	documentationUrl = 'https://usesincerely.com/developer?tab=reference';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'sk_live_...',
			description:
				'Create one in Sincerely under Settings > API & webhooks > API keys. Give it read and write access so every operation and the trigger work.',
		},
		{
			displayName: 'API URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: 'https://skysend-api.onrender.com',
			description: 'Where the Sincerely API lives. Only change this for a self-hosted Sincerely.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "").replace(/\\/(api\\/)?v1$/, "")}}/v1',
			url: '/me',
			method: 'GET',
		},
	};
}

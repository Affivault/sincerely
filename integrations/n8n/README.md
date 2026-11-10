# n8n-nodes-sincerely

Sincerely for [n8n](https://n8n.io): start workflows the moment a reply comes in, and add contacts, put people into cold email campaigns and unsubscribe them from any workflow.

[Sincerely](https://usesincerely.com) is a cold email outreach platform. Relay, its reply reader, works out what each reply means: interested, asking for a meeting, an objection, not now, and so on.

## Installation

In n8n, go to **Settings > Community nodes > Install**, enter `n8n-nodes-sincerely` and confirm. See n8n's [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) for details.

## Credentials

1. In Sincerely, open **Settings > API & webhooks > API keys** and create a key with **read and write** access.
2. In n8n, create a **Sincerely API** credential and paste the key. Leave **API URL** as it is unless you run Sincerely yourself.

## Sincerely Trigger

Choose one or more events. Activating the workflow creates a webhook in Sincerely for exactly those events, and deactivating it removes it.

| Event | When |
|---|---|
| Interested Reply | Relay read a reply as interested or asking for a meeting |
| Reply Received | A contact replied to a campaign email |
| Reply Classified | Relay read a reply, whatever it found |
| Contact Created / Updated / Unsubscribed | A contact was added, changed, or unsubscribed |
| Email Sent / Opened / Link Clicked / Bounced | Campaign email activity |
| Campaign Paused / Completed | A campaign stopped or finished |

Each delivery carries the whole contact and campaign, plus the reply where there is one. Every delivery is signed by Sincerely and checked by the node: anything posted to the workflow's address without a valid signature is refused. You can limit any trigger to one campaign under **Options**.

## Sincerely node

| Resource | Operations |
|---|---|
| Contact | Create or Update, Get (by email or ID), Get Many (search and filter), Delete, Unsubscribe |
| Campaign | Add Contact, Remove Contact, Get, Get Many, Pause, Resume |
| List | Add Contact, Remove Contact, Get Many |
| Reply | Get Many (filter by what Relay read, campaign and time) |

- **Add Contact** to a campaign returns that person's own outcome: added, skipped, not found or invalid, with the reason in words. Nobody unsubscribed, suppressed or bounced is ever added.
- **Fields left empty never clear anything** in Sincerely.
- The node can be used as a tool by n8n AI agents.

## Compatibility

Built and tested with n8n's node CLI and `n8n-workflow` 2.x, using n8nNodesApiVersion 1.

## Resources

- [Sincerely API reference](https://usesincerely.com/developer?tab=reference)
- [n8n community nodes](https://docs.n8n.io/integrations/#community-nodes)

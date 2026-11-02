# Free email verification server

Sincerely can check whether a mailbox exists for free, by asking the
recipient's mail server directly. That needs outbound port 25, which Render
blocks. This small server (about 4 to 5 pounds a month) gives Sincerely a
port 25 to use. Until it is set up, Verify buttons use Icypeas instead
(0.1 credit per check), and they keep using Icypeas as the fallback after.

## 1. Create the server

Any provider that allows outbound port 25. Good options:

| Provider | Plan | Price | Port 25 |
|---|---|---|---|
| Hetzner Cloud | CX22, Ubuntu 24.04 | about 4 EUR/month | Blocked for the first month; open a support ticket asking to unblock it |
| OVHcloud VPS | VPS-1, Ubuntu 24.04 | about 4 GBP/month | Usually open |
| Vultr | Cloud Compute 1 GB | about 5 USD/month | Blocked; request unblock in a ticket |

Do not use DigitalOcean, AWS Lightsail, Google Cloud or Azure: they block
port 25 and rarely lift it.

When creating it, paste the whole of [setup.sh](setup.sh) into the
"Cloud config" or "User data" box. If there is no such box, log in and run
`bash setup.sh` as root.

## 2. Finish setup

The script prints (and saves to `/root/sincerely-proxy.txt`) three values
and two DNS steps:

1. DNS: an A record `verify.usesincerely.com` pointing at the server's IP.
2. Provider panel: set reverse DNS (PTR) of the IP to `verify.usesincerely.com`.
3. Render, Environment of the Sincerely server: add `VERIFY_SMTP_PROXY`,
   `VERIFY_HELO_NAME` and `VERIFY_FROM_EMAIL` exactly as printed.

After Render redeploys, the Verification page stops suggesting an SMTP proxy, and free checks run before any Icypeas credit is used.

## Notes

- The proxy only allows port 25 and needs a password, so it cannot be used
  as an open relay. Nothing is ever sent: a check stops before any email.
- To lock it to Render only, rerun with `ALLOW_FROM=<Render outbound IPs>`
  (Render dashboard, service, Connect, Outbound).
- Catch-all domains still come back as "unconfirmed": no server can prove a
  mailbox exists on a domain that accepts everything.
- Blacklist monitoring: add `SPAMHAUS_DQS_KEY` on Render (free Spamhaus Data
  Query Service key from spamhaus.com) so Spamhaus results come through.
  Without it, Spamhaus refuses lookups from Render's resolver and shows as
  "not checked".

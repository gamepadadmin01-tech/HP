# Inbound email setup — user replies land in the admin portal

When you reply to a ticket, the email the user receives has a per-ticket
Reply-To address: `ticket+<ticket-id>@<EMAIL_REPLY_DOMAIN>`. If the user just
hits "Reply" in Gmail/Outlook, Brevo receives that email, parses it, and POSTs
it to this backend — which attaches it to the right ticket as a conversation
message and flags it "● New reply" in the admin portal.

One-time setup, three steps:

## 1. DNS — point a subdomain's mail at Brevo

Add **two MX records** for a dedicated subdomain (it must NOT be your sending
domain — a subdomain like `reply.` is perfect):

| Host (subdomain)        | Type | Priority | Value                    |
| ----------------------- | ---- | -------- | ------------------------ |
| `reply.yourdomain.com`  | MX   | 10       | `inbound1.sendinblue.com.` |
| `reply.yourdomain.com`  | MX   | 20       | `inbound2.sendinblue.com.` |

DNS can take a few hours to propagate — do this first.

## 2. Register the webhook with Brevo

Pick a long random token (e.g. run `openssl rand -hex 24`), then register the
inbound webhook (replace YOUR-BREVO-API-KEY, your backend URL and TOKEN):

```bash
curl -X POST https://api.brevo.com/v3/webhooks \
  -H "api-key: YOUR-BREVO-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "inbound",
    "events": ["inboundEmailProcessed"],
    "url": "https://YOUR-BACKEND.up.railway.app/api/email/inbound?token=TOKEN",
    "domain": "reply.yourdomain.com",
    "description": "GamepadOS ticket replies"
  }'
```

## 3. Set the environment variables

In Railway (and your local `.env`):

```
EMAIL_REPLY_DOMAIN=reply.yourdomain.com
INBOUND_WEBHOOK_TOKEN=<the same TOKEN as in the webhook URL>
```

Redeploy. Done — reply to a ticket from the admin portal, answer that email
from the user's inbox, and watch it appear in the portal within seconds.

## How matching works (for debugging)

An inbound email is attached to a ticket by, in order:
1. the full ticket UUID in the `ticket+<uuid>@…` recipient address,
2. the short `[#a1b2c3d4]` ref the backend puts in every subject,
3. the newest ticket from that sender's email address.

If nothing matches, the email is forwarded to `ADMIN_EMAIL_USER` so it's never
lost. Replies to resolved tickets automatically reopen them.

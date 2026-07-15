# Push notifications setup

Members can turn on notifications so they get a ping when someone posts —
even when the app is closed. It's **free** (Web Push needs no paid service),
and works on Android, Chrome, Edge, and desktop. On iPhone it works only when
the app is **installed to the Home Screen** (iOS 16.4+).

Everything below is done in web dashboards — nothing to install.

## What you're setting up

1. A table to store each device's subscription.
2. An Edge Function (`send-push`) that sends the notifications.
3. A Database Webhook that runs that function whenever a new post is added.

Your VAPID keys were already generated. The **public** key is in
`js/config.js` (safe to share). You'll need the **private** key below —
if you've lost it, generate a fresh pair (see "Regenerating keys").

## 1. Create the subscriptions table

Supabase → **SQL Editor** → paste [`push-notifications.sql`](push-notifications.sql) → **Run**.

## 2. Deploy the send-push function

1. **Edge Functions → Deploy a new function → Via Editor**.
2. Name it `send-push` (write the name down — the webhook in step 4 must match).
3. Paste the whole of [`send-push-hook.ts`](send-push-hook.ts) → **Deploy**.
4. **Settings → Enforce JWT verification → OFF** (the webhook calls it directly).

## 3. Add the secrets

**Edge Functions → Secrets** → add these two:

- `VAPID_PUBLIC_KEY` = the public key (same one in `js/config.js`)
- `VAPID_PRIVATE_KEY` = your private key

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically —
you don't add them.)

## 4. Fire the function when someone posts

**Database → Webhooks → Create a new hook**:

- **Table:** `posts`
- **Events:** tick **Insert** only
- **Type:** **Supabase Edge Functions** → choose `send-push`
- (Or **HTTP Request** → POST to
  `https://<your-ref>.supabase.co/functions/v1/send-push`)
- Save.

**Also notify on chat messages** — create a *second* webhook exactly the same
way, but with **Table: `messages`**, pointing at the same `send-push` function.
The function tells posts and chat apart automatically (chat pings collapse into
one notification so a busy conversation doesn't flood phones). If you'd rather
keep chat quiet, simply don't create this second webhook.

## 5. Turn it on and test

1. Deploy the site (push to GitHub / re-drag to Netlify).
2. Open the app on a phone or Chrome, go to **Me → 🔔 Notify me about new posts**,
   switch it on, allow the permission prompt.
3. From a **different** account (or ask a friend), make a post. The first device
   should get a notification within a few seconds.

If nothing arrives, open **Edge Functions → send-push → Logs** and make one more
post — the log shows how many devices it sent to and any error.

## Notes & tips

- The author never gets notified about their own post.
- **Alerts** category posts vibrate a bit more (marked urgent).
- Chat messages do **not** send push (a shared room would be too noisy). To add
  that later, create a second webhook on the `messages` table.
- Notifications you don't want? Members can switch the toggle off any time, or
  block them in their browser settings.

## Regenerating keys

If you need a new VAPID pair, run this locally (needs Python):

```python
import base64
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
def b(x): return base64.urlsafe_b64encode(x).rstrip(b"=").decode()
p = ec.generate_private_key(ec.SECP256R1())
print("public :", b(p.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)))
print("private:", b(p.private_numbers().private_value.to_bytes(32, "big")))
```

Put the public key in `js/config.js` and the `VAPID_PUBLIC_KEY` secret; put the
private key in the `VAPID_PRIVATE_KEY` secret. Changing keys logs out existing
subscriptions — members just toggle notifications on again.

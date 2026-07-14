# SMS verification with Clickatell (optional)

By default the app is **free mode**: members join with a phone number + PIN and
no SMS is ever sent. If you have a Clickatell account, you can switch on real
SMS verification:

- New members receive an SMS code to prove the number is theirs (≈ one SMS per
  member, ever — everyday sign-in stays phone + PIN with **no SMS cost**).
- Members who forget their PIN can reset it themselves with an SMS code,
  instead of you deleting their account.

Everything below happens in web dashboards — no tools to install.

## 1. Get your Clickatell API key

1. Sign in at [portal.clickatell.com](https://portal.clickatell.com).
2. Create (or open) an **SMS integration** using the **One API / Messages API**
   (REST). Make sure it's a **production** integration approved to send to
   South African numbers.
3. Copy its **API key**.

## 2. Create the send-sms function in Supabase

1. Supabase dashboard → **Edge Functions** → **Deploy a new function** →
   **Via Editor**.
2. Name it exactly: `send-sms`.
3. Delete the sample code and paste the whole contents of
   [`clickatell-sms-hook.ts`](clickatell-sms-hook.ts), then **Deploy**.
4. Open the function's **Details / Settings** and switch **Enforce JWT
   verification OFF** (Supabase Auth calls this function directly, not a
   logged-in user).

## 3. Connect the pieces

1. **Edge Functions → Secrets** → add:
   - `CLICKATELL_API_KEY` = the key from step 1
2. **Authentication → Hooks** → **Send SMS hook** → Enable. For **Hook type**
   choose **HTTPS** (there is no "Edge Function" choice — an Edge Function is
   just an HTTPS endpoint). Fill in:
   - **URL:** `https://<your-project-ref>.supabase.co/functions/v1/send-sms`
     (your ref is the first part of your Supabase URL — for this project it is
     `https://bwpyhcuhqezujlbxkrsr.supabase.co/functions/v1/send-sms`)
   - Save. Supabase generates a **secret** (starts with `v1,whsec_`) — copy it.
3. Back in **Edge Functions → Secrets** → add:
   - `SEND_SMS_HOOK_SECRET` = that secret
4. **Authentication → Sign In / Providers** → enable the **Phone** provider.
   (Leave "Confirm email" off — email isn't used at all anymore.)

## 4. Flip the switch in the app

In `js/config.js` change:

```js
USE_SMS_VERIFICATION: true,
```

Deploy the site (push to GitHub / re-drag to Netlify) and test a sign-up with
your own number. If no SMS arrives, check **Edge Functions → send-sms → Logs**
— Clickatell's reply is printed there.

## Costs & tips

- Clickatell charges per SMS (~R0.30–0.40 to SA networks). One community
  member ≈ one SMS at sign-up, plus one per PIN reset. A 500-member community
  ≈ R150–R200 in total, spread over time.
- Existing members who joined in free mode (before the switch) keep working —
  but anyone who joined as a *test* is best deleted (Authentication → Users)
  so they can re-join properly with a verified number.
- To go back to free mode any time, set `USE_SMS_VERIFICATION: false`.

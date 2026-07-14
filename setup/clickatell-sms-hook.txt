// ============================================================
// Supabase Edge Function: send-sms
// ------------------------------------------------------------
// Supabase calls this function whenever it needs to SMS a
// verification code; the function passes the message on to
// Clickatell. Full setup steps: see setup/CLICKATELL.md.
//
// Secrets this function needs (Edge Functions → Secrets):
//   CLICKATELL_API_KEY   — from your Clickatell portal
//   SEND_SMS_HOOK_SECRET — shown when you enable the Send SMS
//                          hook (Authentication → Hooks)
// ============================================================

import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

Deno.serve(async (req) => {
  try {
    const payload = await req.text();

    // Check the request really comes from Supabase Auth.
    const secret = (Deno.env.get("SEND_SMS_HOOK_SECRET") ?? "").replace("v1,whsec_", "");
    const wh = new Webhook(secret);
    const { user, sms } = wh.verify(payload, Object.fromEntries(req.headers)) as {
      user: { phone: string };
      sms: { otp: string };
    };

    // Send the code through Clickatell.
    const res = await fetch("https://platform.clickatell.com/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": Deno.env.get("CLICKATELL_API_KEY") ?? "",
      },
      body: JSON.stringify({
        content: `Your Umphakathi code is: ${sms.otp}`,
        to: [user.phone],
      }),
    });

    if (!res.ok) {
      throw new Error(`Clickatell replied ${res.status}: ${await res.text()}`);
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-sms failed:", err);
    return new Response(
      JSON.stringify({ error: { http_code: 500, message: String(err?.message ?? err) } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// ============================================================
// Supabase Edge Function: send-push
// ------------------------------------------------------------
// A Database Webhook calls this whenever a new row is added to
// `posts`. It looks up everyone's push subscriptions and sends
// them a Web Push notification — except the author.
//
// Secrets this function needs (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY   — same public key that is in js/config.js
//   VAPID_PRIVATE_KEY  — the matching private key (keep secret!)
//   SUPABASE_URL       — provided automatically by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — provided automatically by Supabase
//
// Full setup: setup/PUSH-NOTIFICATIONS.md
// ============================================================

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails("mailto:admin@umphakathi.app", VAPID_PUBLIC, VAPID_PRIVATE);

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Friendly category labels for the notification title.
const CATEGORY_LABEL: Record<string, string> = {
  news: "📰 News", general: "💬 Talk", business: "🛒 For Sale",
  event: "🎉 Event", alert: "⚠️ Alert",
};

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const row = payload.record; // Database Webhook sends the new row here
    if (!row) return new Response("no record", { status: 200 });

    // This one function serves two webhooks: posts and chat messages.
    const isMessage = payload.table === "messages";

    // Look up the author's name so the notification reads nicely.
    const { data: author } = await admin
      .from("profiles").select("display_name").eq("id", row.user_id).single();
    const name = author?.display_name ?? "Someone";

    let title: string, tag: string, urgent = false;
    if (isMessage) {
      title = `💬 ${name} in the chat`;
      tag = "chat";                       // chat pings collapse into one
    } else {
      title = `${CATEGORY_LABEL[row.category] ?? "New post"} · ${name}`;
      tag = `post-${row.id}`;
      urgent = row.category === "alert";
    }
    const body = (row.body ?? "").slice(0, 120);

    // Everyone's devices, except the author's own.
    const { data: subs } = await admin
      .from("push_subscriptions").select("endpoint, subscription")
      .neq("user_id", row.user_id);

    const notification = JSON.stringify({ title, body, url: "./index.html", tag, urgent });

    // Send to each device. Drop subscriptions the push service says are gone.
    const results = await Promise.allSettled(
      (subs ?? []).map(async (row) => {
        try {
          await webpush.sendNotification(row.subscription, notification);
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await admin.from("push_subscriptions").delete().eq("endpoint", row.endpoint);
          }
          throw err;
        }
      })
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    return new Response(JSON.stringify({ sent, total: subs?.length ?? 0 }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-push failed:", err);
    return new Response(JSON.stringify({ error: String((err as Error)?.message ?? err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});

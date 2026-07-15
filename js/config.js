/* ============================================================
   Umphakathi – Community Hub configuration
   ------------------------------------------------------------
   EVERYTHING you might want to change lives in this file.

   RUNNING FREE, FOREVER:
   1. The app works instantly in "Demo mode" (data is saved on
      each person's own phone only — good for previewing).
   2. To make it a REAL shared app for the whole community,
      create a free account at https://supabase.com, run the
      setup/schema.sql script in their SQL editor, then paste
      your project URL and anon key below. See README.md.
   ============================================================ */

const CONFIG = {
  // The name of your community app — change it to anything!
  APP_NAME: "Umphakathi",
  TAGLINE: "Belgrade & Pongola Community",

  // The areas members can pick when they join.
  AREAS: ["Belgrade", "Pongola", "Ncotshane", "Magudu", "Other"],

  // Post categories shown in the feed filter and composer.
  CATEGORIES: [
    { id: "news",     label: "News",       icon: "📰" },
    { id: "general",  label: "Talk",       icon: "💬" },
    { id: "business", label: "For Sale",   icon: "🛒" },
    { id: "event",    label: "Events",     icon: "🎉" },
    { id: "alert",    label: "Alerts",     icon: "⚠️" },
  ],

  // Emoji reactions members can give a post (Facebook-style).
  REACTIONS: ["👍", "❤️", "😂", "😮", "😢", "😡"],

  // ---- SMS verification via Clickatell (optional) ----
  // false = free mode: members join with phone + PIN, no SMS ever sent.
  // true  = new members get an SMS code to verify their number (about
  //         one SMS per member, ever) and "Forgot PIN?" works by SMS.
  //         Requires the one-time setup in setup/CLICKATELL.md first!
  USE_SMS_VERIFICATION: false,

  // ---- Supabase (free tier) — leave blank for Demo mode ----
  SUPABASE_URL: "https://bwpyhcuhqezujlbxkrsr.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3cHloY3VocWV6dWpsYnhrcnNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNDM2NjcsImV4cCI6MjA5OTYxOTY2N30.ENeGR5c7mk-WidwrtEI4f_C5NWr_cjpTP3CGOohVm8w",
};

/* ============================================================
   Data layer.
   Two modes, same API — the rest of the app never needs to know
   which one is running:

   • DEMO MODE (default): data lives in this browser's
     localStorage with friendly sample content, so the app can
     be previewed with zero setup. Not shared between phones.

   • SUPABASE MODE: activates automatically when SUPABASE_URL
     and SUPABASE_ANON_KEY are filled in js/config.js. Real
     shared data, real accounts, realtime chat — free tier.
   ============================================================ */

const DB = (() => {
  // Accept the URL however it was pasted from the Supabase dashboard —
  // trailing slashes or an accidental /rest/v1/ suffix are stripped.
  const SUPABASE_URL = (CONFIG.SUPABASE_URL || "")
    .replace(/\/(rest|auth|storage|realtime)\/v\d+\/?$/, "")
    .replace(/\/+$/, "");
  const useSupabase = !!(SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
  let sb = null; // supabase client
  let onMessageCallback = null;

  /* ----------------------------------------------------------
     DEMO MODE — localStorage
     ---------------------------------------------------------- */
  const LS = {
    read(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
      catch { return fallback; }
    },
    write(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
  };

  // "071 234 5678" → "+27712345678". Accepts any common way of writing
  // a South African number so the same person always gets the same account.
  function toE164(phone) {
    let d = String(phone ?? "").replace(/\D/g, "");
    if (d.startsWith("0")) d = "27" + d.slice(1); // SA local → international
    if (d.length < 9 || d.length > 13) throw new Error("Please enter a valid phone number.");
    return "+" + d;
  }

  // Free mode (no SMS): members sign in with a phone number, but Supabase
  // accounts need an email-shaped ID — so "071 234 5678" becomes
  // "p27712345678@members.app" behind the scenes. Nothing is ever sent.
  function phoneToEmail(phone) {
    return `p${toE164(phone).slice(1)}@members.app`;
  }

  function emailToPhone(email) {
    const m = /^p(\d+)@members\.app$/.exec(email ?? "");
    return m ? `+${m[1]}` : null;
  }

  const uid = () => Math.random().toString(36).slice(2, 10);
  const now = () => new Date().toISOString();

  // Demo data stored likes as plain names before reactions existed —
  // treat those as a 👍 so old posts keep their counts.
  const normLikes = (likes) =>
    (likes ?? []).map((l) => (typeof l === "string" ? { name: l, reaction: "👍" } : l));
  const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

  function seedDemoData() {
    if (LS.read("ch_seeded", false)) return;

    LS.write("ch_posts", [
      {
        id: uid(), author: "Thandi Nkosi", area: "Pongola", category: "news",
        text: "The road works on the R66 near the taxi rank start on Monday. Expect delays in the morning — leave early if you work in town! 🚧",
        image: null, createdAt: minsAgo(45),
        likes: ["Sipho Zulu", "Bongani M."], comments: [
          { id: uid(), author: "Sipho Zulu", text: "Thanks for the heads up sisi 🙏", createdAt: minsAgo(30) },
        ],
      },
      {
        id: uid(), author: "AfricanSpring Ice & Water", area: "Belgrade", category: "business",
        text: "❄️ Weekend special! 2kg ice bags — order before Friday for delivery in Belgrade & Pongola. Clean, purified, ice cold. WhatsApp us to order!",
        image: null, createdAt: minsAgo(120),
        likes: ["Thandi Nkosi"], comments: [],
      },
      {
        id: uid(), author: "Pastor Dumisani", area: "Ncotshane", category: "event",
        text: "Community clean-up this Saturday 8am, meeting at the sports ground. Bring gloves if you have — refreshments provided. Everyone welcome! 🌍",
        image: null, createdAt: minsAgo(300),
        likes: ["Thandi Nkosi", "Sipho Zulu", "Nomvula K.", "Bongani M."], comments: [
          { id: uid(), author: "Nomvula K.", text: "Count me in!", createdAt: minsAgo(240) },
          { id: uid(), author: "Bongani M.", text: "I'll bring the youth group 💪", createdAt: minsAgo(200) },
        ],
      },
      {
        id: uid(), author: "Nomvula K.", area: "Pongola", category: "alert",
        text: "⚠️ Load shedding stage 2 tonight 6pm–8:30pm for Pongola town. Charge your phones and fill water bottles now.",
        image: null, createdAt: minsAgo(600),
        likes: ["Sipho Zulu"], comments: [],
      },
    ]);

    LS.write("ch_messages", [
      { id: uid(), author: "Sipho Zulu", text: "Sanibonani nonke! 👋", createdAt: minsAgo(90) },
      { id: uid(), author: "Thandi Nkosi", text: "Sawubona Sipho! How is everyone today?", createdAt: minsAgo(85) },
      { id: uid(), author: "Bongani M.", text: "All good this side. Anyone know if the clinic is open on Saturday?", createdAt: minsAgo(60) },
      { id: uid(), author: "Nomvula K.", text: "Yes, until 12 noon only.", createdAt: minsAgo(55) },
    ]);

    LS.write("ch_businesses", [
      {
        id: uid(), name: "AfricanSpring Ice & Water", owner: "AfricanSpring",
        category: "Food & Drink", area: "Belgrade",
        description: "Premium ice and purified water delivered to businesses and homes across Belgrade & Pongola. Bulk orders welcome.",
        phone: "+27 000 000 0000", whatsapp: "+27 000 000 0000",
      },
      {
        id: uid(), name: "Thandi's Salon", owner: "Thandi Nkosi",
        category: "Beauty", area: "Pongola",
        description: "Braids, cuts, relaxer and nails. Walk-ins welcome, Mon–Sat.",
        phone: "+27 000 000 0001", whatsapp: "+27 000 000 0001",
      },
      {
        id: uid(), name: "Bongani's Panel Beating", owner: "Bongani M.",
        category: "Motor & Repairs", area: "Ncotshane",
        description: "Dent removal, spray painting and windscreen replacement. Fair prices for the community.",
        phone: "+27 000 000 0002", whatsapp: "",
      },
    ]);

    LS.write("ch_seeded", true);
  }

  /* ----------------------------------------------------------
     Shared API
     ---------------------------------------------------------- */
  return {
    get mode() { return useSupabase ? "supabase" : "demo"; },

    async init() {
      if (useSupabase) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
        sb = window.supabase.createClient(SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
        // Realtime chat: notify the UI whenever anyone sends a message.
        sb.channel("room")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
            if (onMessageCallback) onMessageCallback(payload.new);
          })
          .subscribe();
      } else {
        seedDemoData();
      }
    },

    /* ---------------- Auth / current user ---------------- */

    async currentUser() {
      if (useSupabase) {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return null;
        const { data: profile } = await sb.from("profiles").select("*").eq("id", user.id).single();
        if (!profile) return null;
        const phone = user.phone ? `+${user.phone}` : emailToPhone(user.email);
        return {
          id: user.id, name: profile.display_name, area: profile.area,
          phone, email: phone ? null : user.email,
        };
      }
      return LS.read("ch_user", null);
    },

    // True when SMS codes are available (Clickatell hook configured).
    get supportsOtp() { return useSupabase && !!CONFIG.USE_SMS_VERIFICATION; },

    // Demo: join with just a name. Supabase: phone number + PIN.
    // With SMS verification on, sign-up pauses for an SMS code:
    // the caller gets { needsOtp: true } and must call verifyOtp next.
    async signUp({ name, area, phone, password }) {
      if (useSupabase) {
        const creds = this.supportsOtp
          ? { phone: toE164(phone), password }
          : { email: phoneToEmail(phone), password };
        const { data, error } = await sb.auth.signUp(creds);
        if (error) {
          if (/already registered/i.test(error.message))
            throw new Error("That phone number is already a member — tap Sign in instead.");
          throw new Error(error.message);
        }
        if (this.supportsOtp) return { needsOtp: true, phone };
        const { error: pErr } = await sb.from("profiles")
          .insert({ id: data.user.id, display_name: name, area });
        if (pErr) throw new Error(pErr.message);
        return { id: data.user.id, name, area, phone: toE164(phone) };
      }
      const user = { id: uid(), name, area };
      LS.write("ch_user", user);
      return user;
    },

    // Step 2 of SMS sign-up: check the code, then create the profile.
    async verifyOtp({ phone, token, name, area }) {
      const { data, error } = await sb.auth.verifyOtp({ phone: toE164(phone), token, type: "sms" });
      if (error) {
        if (/invalid|expired/i.test(error.message))
          throw new Error("That code is wrong or has expired — please try again.");
        throw new Error(error.message);
      }
      const { error: pErr } = await sb.from("profiles")
        .insert({ id: data.user.id, display_name: name, area });
      if (pErr && pErr.code !== "23505") throw new Error(pErr.message); // 23505 = profile already exists
      return { id: data.user.id, name, area, phone: toE164(phone) };
    },

    async resendOtp(phone) {
      const { error } = await sb.auth.resend({ type: "sms", phone: toE164(phone) });
      if (error) throw new Error(error.message);
    },

    // "Forgot PIN": SMS a login code, then set a new PIN once verified.
    async requestPinReset(phone) {
      const { error } = await sb.auth.signInWithOtp({
        phone: toE164(phone),
        options: { shouldCreateUser: false },
      });
      if (error) {
        if (/not found|signups not allowed/i.test(error.message))
          throw new Error("That phone number is not a member yet.");
        throw new Error(error.message);
      }
    },

    async confirmPinReset({ phone, token, newPin }) {
      const { error } = await sb.auth.verifyOtp({ phone: toE164(phone), token, type: "sms" });
      if (error) {
        if (/invalid|expired/i.test(error.message))
          throw new Error("That code is wrong or has expired — please try again.");
        throw new Error(error.message);
      }
      const { error: uErr } = await sb.auth.updateUser({ password: newPin });
      if (uErr) throw new Error(uErr.message);
      return this.currentUser();
    },

    async signIn({ phone, password }) {
      if (useSupabase) {
        const creds = this.supportsOtp
          ? { phone: toE164(phone), password }
          : { email: phoneToEmail(phone), password };
        const { error } = await sb.auth.signInWithPassword(creds);
        if (error) {
          if (/invalid login credentials/i.test(error.message))
            throw new Error("Phone number or PIN is wrong — please try again.");
          throw new Error(error.message);
        }
        return this.currentUser();
      }
      return null; // demo mode has no sign-in, only join
    },

    async signOut() {
      if (useSupabase) await sb.auth.signOut();
      else localStorage.removeItem("ch_user");
    },

    async updateProfile({ name, area }) {
      if (useSupabase) {
        const { data: { user } } = await sb.auth.getUser();
        const { error } = await sb.from("profiles")
          .update({ display_name: name, area }).eq("id", user.id);
        if (error) throw new Error(error.message);
        return;
      }
      const user = LS.read("ch_user", {});
      user.name = name; user.area = area;
      LS.write("ch_user", user);
    },

    async changePin(newPin) {
      if (!useSupabase) throw new Error("Changing your PIN is only available in the live version.");
      const { error } = await sb.auth.updateUser({ password: newPin });
      if (error) throw new Error(error.message);
    },

    /* ---------------- Feed / posts ---------------- */

    async getPosts() {
      if (useSupabase) {
        // NOTE: posts relate to profiles two ways (author + via likes), so the
        // author join must name its foreign key or PostgREST refuses (error 300).
        const { data, error } = await sb.from("posts")
          .select("*, profiles!posts_user_id_fkey(display_name, area), likes(user_id, reaction), comments(id, body, created_at, parent_id, profiles!comments_user_id_fkey(display_name))")
          .order("created_at", { ascending: false }).limit(100);
        if (error) throw new Error(error.message);
        const { data: { user } } = await sb.auth.getUser();
        return data.map((p) => {
          const reactions = {};
          for (const l of p.likes) {
            const r = l.reaction || "👍";
            reactions[r] = (reactions[r] || 0) + 1;
          }
          const flat = (p.comments ?? [])
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((c) => ({
              id: c.id, author: c.profiles?.display_name ?? "Member",
              text: c.body, createdAt: c.created_at, parentId: c.parent_id,
            }));
          return {
            id: p.id,
            author: p.profiles?.display_name ?? "Member",
            area: p.profiles?.area ?? "",
            category: p.category,
            text: p.body,
            image: p.image_url,
            createdAt: p.created_at,
            reactions,
            myReaction: user ? (p.likes.find((l) => l.user_id === user.id)?.reaction ?? null) : null,
            commentCount: flat.length,
            comments: flat.filter((c) => !c.parentId)
              .map((c) => ({ ...c, replies: flat.filter((r) => r.parentId === c.id) })),
          };
        });
      }
      const me = LS.read("ch_user", {});
      return LS.read("ch_posts", [])
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((p) => {
          const likes = normLikes(p.likes);
          const reactions = {};
          for (const l of likes) reactions[l.reaction] = (reactions[l.reaction] || 0) + 1;
          const flat = (p.comments ?? []).map((c) => ({ ...c, parentId: c.parentId ?? null }));
          return {
            ...p,
            reactions,
            myReaction: likes.find((l) => l.name === me.name)?.reaction ?? null,
            commentCount: flat.length,
            comments: flat.filter((c) => !c.parentId)
              .map((c) => ({ ...c, replies: flat.filter((r) => r.parentId === c.id) })),
          };
        });
    },

    async createPost({ text, category, image }) {
      if (useSupabase) {
        const { data: { user } } = await sb.auth.getUser();
        let image_url = null;
        if (image) {
          const path = `${user.id}/${Date.now()}.jpg`;
          const { error: upErr } = await sb.storage.from("photos").upload(path, image);
          if (upErr) throw new Error(upErr.message);
          image_url = sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
        }
        const { error } = await sb.from("posts").insert({ user_id: user.id, body: text, category, image_url });
        if (error) throw new Error(error.message);
        return;
      }
      const me = LS.read("ch_user", {});
      const posts = LS.read("ch_posts", []);
      // In demo mode `image` arrives as a data URL string (or null).
      posts.unshift({
        id: uid(), author: me.name, area: me.area, category, text,
        image: image || null, createdAt: now(), likes: [], comments: [],
      });
      LS.write("ch_posts", posts);
    },

    // Set (or change) my emoji reaction on a post; pass null to remove it.
    // The likes table allows one row per member per post, so a change is an upsert.
    async setReaction(postId, emoji) {
      if (useSupabase) {
        const { data: { user } } = await sb.auth.getUser();
        if (!emoji) {
          await sb.from("likes").delete().eq("post_id", postId).eq("user_id", user.id);
          return;
        }
        const { error } = await sb.from("likes")
          .upsert({ post_id: postId, user_id: user.id, reaction: emoji }, { onConflict: "post_id,user_id" });
        if (error) throw new Error(error.message);
        return;
      }
      const me = LS.read("ch_user", {});
      const posts = LS.read("ch_posts", []);
      const post = posts.find((p) => p.id === postId);
      if (!post) return;
      post.likes = normLikes(post.likes).filter((l) => l.name !== me.name);
      if (emoji) post.likes.push({ name: me.name, reaction: emoji });
      LS.write("ch_posts", posts);
    },

    async addComment(postId, text, parentId = null) {
      if (useSupabase) {
        const { data: { user } } = await sb.auth.getUser();
        const { error } = await sb.from("comments")
          .insert({ post_id: postId, user_id: user.id, body: text, parent_id: parentId });
        if (error) throw new Error(error.message);
        return;
      }
      const me = LS.read("ch_user", {});
      const posts = LS.read("ch_posts", []);
      const post = posts.find((p) => p.id === postId);
      if (!post) return;
      post.comments.push({ id: uid(), author: me.name, text, createdAt: now(), parentId });
      LS.write("ch_posts", posts);
    },

    /* ---------------- Chat ---------------- */

    async getMessages() {
      if (useSupabase) {
        const { data, error } = await sb.from("messages")
          .select("*, profiles(display_name)")
          .order("created_at", { ascending: true }).limit(200);
        if (error) throw new Error(error.message);
        return data.map((m) => ({
          id: m.id, author: m.profiles?.display_name ?? "Member",
          text: m.body, createdAt: m.created_at,
        }));
      }
      return LS.read("ch_messages", []);
    },

    async sendMessage(text) {
      if (useSupabase) {
        const { data: { user } } = await sb.auth.getUser();
        const { error } = await sb.from("messages").insert({ user_id: user.id, body: text });
        if (error) throw new Error(error.message);
        return;
      }
      const me = LS.read("ch_user", {});
      const msgs = LS.read("ch_messages", []);
      msgs.push({ id: uid(), author: me.name, text, createdAt: now() });
      LS.write("ch_messages", msgs);
    },

    // Realtime: only fires in Supabase mode.
    onNewMessage(cb) { onMessageCallback = cb; },

    /* ---------------- Business directory ---------------- */

    async getBusinesses() {
      if (useSupabase) {
        const { data, error } = await sb.from("businesses")
          .select("*, profiles(display_name)").order("name");
        if (error) throw new Error(error.message);
        return data.map((b) => ({
          id: b.id, name: b.name, owner: b.profiles?.display_name ?? "Member",
          category: b.category, area: b.area, description: b.description,
          phone: b.phone, whatsapp: b.whatsapp,
        }));
      }
      return LS.read("ch_businesses", []).slice().sort((a, b) => a.name.localeCompare(b.name));
    },

    async addBusiness({ name, category, area, description, phone, whatsapp }) {
      if (useSupabase) {
        const { data: { user } } = await sb.auth.getUser();
        const { error } = await sb.from("businesses")
          .insert({ user_id: user.id, name, category, area, description, phone, whatsapp });
        if (error) throw new Error(error.message);
        return;
      }
      const me = LS.read("ch_user", {});
      const list = LS.read("ch_businesses", []);
      list.push({ id: uid(), owner: me.name, name, category, area, description, phone, whatsapp });
      LS.write("ch_businesses", list);
    },
  };
})();

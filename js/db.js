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
  let roomChannel = null;
  let onMessageCallback = null;
  let onTypingCallback = null;

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

  // Turn a flat comment list into a nested tree so a reply-to-a-reply nests
  // under its parent (any depth). Each node gets a `replies` array.
  const buildCommentTree = (flat) => {
    const byId = {};
    flat.forEach((c) => (byId[c.id] = { ...c, replies: [] }));
    const roots = [];
    flat.forEach((c) => {
      const node = byId[c.id];
      const parent = c.parentId && byId[c.parentId];
      if (parent) parent.replies.push(node);
      else roots.push(node);
    });
    return roots;
  };
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
        // Realtime chat: notify the UI when anyone sends a message, reacts, or types.
        roomChannel = sb.channel("room", { config: { broadcast: { self: false } } })
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {
            if (onMessageCallback) onMessageCallback();
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, () => {
            if (onMessageCallback) onMessageCallback();
          })
          .on("broadcast", { event: "typing" }, ({ payload }) => {
            if (onTypingCallback) onTypingCallback(payload);
          })
          .subscribe();
      } else {
        seedDemoData();
      }
    },

    // Tell the room I'm typing (or stopped). Broadcast only — nothing stored.
    sendTyping(name, isTyping) {
      if (!useSupabase || !roomChannel) return;
      roomChannel.send({ type: "broadcast", event: "typing", payload: { name, isTyping } });
    },
    onTyping(cb) { onTypingCallback = cb; },

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
          avatar: profile.avatar_url || null,
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

    // Upload a profile picture and save its URL. Returns the new avatar URL.
    // Demo mode keeps a data-URL on the device.
    async setAvatar(fileOrDataUrl) {
      if (useSupabase) {
        const { data: { user } } = await sb.auth.getUser();
        // IMPORTANT: the storage policy requires the first folder to be the
        // member's own id, so the path must start with `${user.id}/`.
        const path = `${user.id}/avatar.jpg`;
        const { error: upErr } = await sb.storage.from("photos")
          .upload(path, fileOrDataUrl, { upsert: true, contentType: fileOrDataUrl.type || "image/jpeg" });
        if (upErr) throw new Error(upErr.message);
        // cache-bust so the new photo shows immediately
        const url = sb.storage.from("photos").getPublicUrl(path).data.publicUrl + "?t=" + Date.now();
        const { error } = await sb.from("profiles").update({ avatar_url: url }).eq("id", user.id);
        if (error) throw new Error(error.message);
        return url;
      }
      const user = LS.read("ch_user", {});
      user.avatar = fileOrDataUrl; // data URL string in demo
      LS.write("ch_user", user);
      return fileOrDataUrl;
    },

    async changePin(newPin) {
      if (!useSupabase) throw new Error("Changing your PIN is only available in the live version.");
      const { error } = await sb.auth.updateUser({ password: newPin });
      if (error) throw new Error(error.message);
    },

    /* ---------------- Push notifications ---------------- */

    // True only when push is fully available (live mode + a VAPID key + the
    // browser supports it). Used to decide whether to show the toggle.
    get supportsPush() {
      return useSupabase && !!CONFIG.VAPID_PUBLIC_KEY &&
        typeof window !== "undefined" &&
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    },

    // Save this device's push subscription against the signed-in member.
    async savePushSubscription(sub) {
      if (!useSupabase) return;
      const { data: { user } } = await sb.auth.getUser();
      const json = sub.toJSON();
      const { error } = await sb.from("push_subscriptions").upsert(
        { user_id: user.id, endpoint: json.endpoint, subscription: json },
        { onConflict: "endpoint" }
      );
      if (error) throw new Error(error.message);
    },

    async removePushSubscription(endpoint) {
      if (!useSupabase || !endpoint) return;
      await sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
    },

    /* ---------------- Feed / posts ---------------- */

    async getPosts() {
      if (useSupabase) {
        // NOTE: posts relate to profiles two ways (author + via likes), so the
        // author join must name its foreign key or PostgREST refuses (error 300).
        const { data, error } = await sb.from("posts")
          .select("*, profiles!posts_user_id_fkey(display_name, area, avatar_url), likes(user_id, reaction), comments(id, body, audio_url, created_at, parent_id, user_id, profiles!comments_user_id_fkey(display_name, avatar_url), comment_likes(user_id))")
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
              authorAvatar: c.profiles?.avatar_url ?? null,
              mine: user ? c.user_id === user.id : false,
              likeCount: (c.comment_likes ?? []).length,
              likedByMe: user ? (c.comment_likes ?? []).some((l) => l.user_id === user.id) : false,
              text: c.body, audio: c.audio_url, createdAt: c.created_at, parentId: c.parent_id,
            }));
          return {
            id: p.id,
            author: p.profiles?.display_name ?? "Member",
            authorAvatar: p.profiles?.avatar_url ?? null,
            area: p.profiles?.area ?? "",
            category: p.category,
            text: p.body,
            image: p.image_url,
            createdAt: p.created_at,
            editedAt: p.edited_at || null,
            mine: user ? p.user_id === user.id : false,
            reactions,
            myReaction: user ? (p.likes.find((l) => l.user_id === user.id)?.reaction ?? null) : null,
            commentCount: flat.length,
            comments: buildCommentTree(flat),
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
          const flat = (p.comments ?? []).map((c) => ({
            ...c, parentId: c.parentId ?? null, mine: c.author === me.name,
            authorAvatar: c.authorAvatar ?? null,
            likeCount: (c.likes ?? []).length,
            likedByMe: (c.likes ?? []).includes(me.name),
          }));
          return {
            ...p,
            authorAvatar: p.authorAvatar ?? (p.author === me.name ? me.avatar : null) ?? null,
            mine: p.author === me.name,
            reactions,
            myReaction: likes.find((l) => l.name === me.name)?.reaction ?? null,
            commentCount: flat.length,
            comments: buildCommentTree(flat),
          };
        });
    },

    async deletePost(postId) {
      if (useSupabase) {
        const { error } = await sb.from("posts").delete().eq("id", postId);
        if (error) throw new Error(error.message);
        return;
      }
      const posts = LS.read("ch_posts", []).filter((p) => p.id !== postId);
      LS.write("ch_posts", posts);
    },

    async editPost(postId, text) {
      if (useSupabase) {
        const { error } = await sb.from("posts")
          .update({ body: text, edited_at: new Date().toISOString() }).eq("id", postId);
        if (error) throw new Error(error.message);
        return;
      }
      const posts = LS.read("ch_posts", []);
      const post = posts.find((p) => p.id === postId);
      if (post) { post.text = text; post.editedAt = now(); LS.write("ch_posts", posts); }
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
        authorAvatar: me.avatar || null,
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

    async addComment(postId, text, parentId = null, audio = null) {
      if (useSupabase) {
        const { data: { user } } = await sb.auth.getUser();
        let audio_url = null;
        if (audio) {
          const path = `${user.id}/voice-${Date.now()}.webm`;
          const { error: upErr } = await sb.storage.from("photos")
            .upload(path, audio, { contentType: "audio/webm" });
          if (upErr) throw new Error(upErr.message);
          audio_url = sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
        }
        const { error } = await sb.from("comments")
          .insert({ post_id: postId, user_id: user.id, body: text, parent_id: parentId, audio_url });
        if (error) throw new Error(error.message);
        return;
      }
      const me = LS.read("ch_user", {});
      const posts = LS.read("ch_posts", []);
      const post = posts.find((p) => p.id === postId);
      if (!post) return;
      post.comments.push({ id: uid(), author: me.name, authorAvatar: me.avatar || null, text, audio: audio || null, createdAt: now(), parentId, likes: [] });
      LS.write("ch_posts", posts);
    },

    async toggleCommentLike(commentId) {
      if (useSupabase) {
        const { data: { user } } = await sb.auth.getUser();
        const { data: existing } = await sb.from("comment_likes")
          .select("comment_id").eq("comment_id", commentId).eq("user_id", user.id).maybeSingle();
        if (existing) await sb.from("comment_likes").delete().eq("comment_id", commentId).eq("user_id", user.id);
        else await sb.from("comment_likes").insert({ comment_id: commentId, user_id: user.id });
        return;
      }
      const me = LS.read("ch_user", {});
      const posts = LS.read("ch_posts", []);
      for (const p of posts) {
        const c = (p.comments ?? []).find((x) => x.id === commentId);
        if (c) {
          c.likes = c.likes ?? [];
          const i = c.likes.indexOf(me.name);
          if (i >= 0) c.likes.splice(i, 1); else c.likes.push(me.name);
          LS.write("ch_posts", posts);
          return;
        }
      }
    },

    // Delete a comment. Its replies cascade away (DB) / are pruned (demo).
    async deleteComment(commentId) {
      if (useSupabase) {
        const { error } = await sb.from("comments").delete().eq("id", commentId);
        if (error) throw new Error(error.message);
        return;
      }
      const posts = LS.read("ch_posts", []);
      for (const p of posts) {
        if (!p.comments) continue;
        // remove the comment and anything descended from it
        const toRemove = new Set([commentId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const c of p.comments) {
            if (c.parentId && toRemove.has(c.parentId) && !toRemove.has(c.id)) {
              toRemove.add(c.id); changed = true;
            }
          }
        }
        const before = p.comments.length;
        p.comments = p.comments.filter((c) => !toRemove.has(c.id));
        if (p.comments.length !== before) { LS.write("ch_posts", posts); return; }
      }
    },

    /* ---------------- Chat ---------------- */

    async getMessages() {
      if (useSupabase) {
        const { data, error } = await sb.from("messages")
          .select("*, profiles!messages_user_id_fkey(display_name, avatar_url), message_reactions(user_id, reaction)")
          .order("created_at", { ascending: true }).limit(200);
        // (image_url and audio_url come through via *)
        if (error) throw new Error(error.message);
        const { data: { user } } = await sb.auth.getUser();
        const byId = {};
        data.forEach((m) => (byId[m.id] = { author: m.profiles?.display_name ?? "Member", text: m.body }));
        return data.map((m) => {
          const reactions = {};
          for (const r of m.message_reactions ?? []) {
            reactions[r.reaction] = (reactions[r.reaction] || 0) + 1;
          }
          return {
            id: m.id, author: m.profiles?.display_name ?? "Member",
            authorAvatar: m.profiles?.avatar_url ?? null,
            mine: user ? m.user_id === user.id : false,
            text: m.body, image: m.image_url, audio: m.audio_url, createdAt: m.created_at,
            parentId: m.parent_id,
            replyTo: m.parent_id ? byId[m.parent_id] ?? null : null,
            reactions,
            myReaction: user ? (m.message_reactions?.find((r) => r.user_id === user.id)?.reaction ?? null) : null,
          };
        });
      }
      const me = LS.read("ch_user", {});
      const msgs = LS.read("ch_messages", []);
      const byId = {};
      msgs.forEach((m) => (byId[m.id] = { author: m.author, text: m.text }));
      return msgs.map((m) => {
        const likes = normLikes(m.reactions);
        const reactions = {};
        for (const l of likes) reactions[l.reaction] = (reactions[l.reaction] || 0) + 1;
        return {
          ...m,
          authorAvatar: m.authorAvatar ?? (m.author === me.name ? me.avatar : null) ?? null,
          mine: m.author === me.name,
          parentId: m.parentId ?? null,
          replyTo: m.parentId ? byId[m.parentId] ?? null : null,
          reactions,
          myReaction: likes.find((l) => l.name === me.name)?.reaction ?? null,
        };
      });
    },

    async sendMessage(text, parentId = null, image = null, audio = null) {
      if (useSupabase) {
        const { data: { user } } = await sb.auth.getUser();
        let image_url = null, audio_url = null;
        if (image) {
          const path = `${user.id}/chat-${Date.now()}.jpg`;
          const { error: upErr } = await sb.storage.from("photos").upload(path, image);
          if (upErr) throw new Error(upErr.message);
          image_url = sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
        }
        if (audio) {
          const path = `${user.id}/voice-${Date.now()}.webm`;
          const { error: upErr } = await sb.storage.from("photos").upload(path, audio, { contentType: "audio/webm" });
          if (upErr) throw new Error(upErr.message);
          audio_url = sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
        }
        const { error } = await sb.from("messages")
          .insert({ user_id: user.id, body: text, parent_id: parentId, image_url, audio_url });
        if (error) throw new Error(error.message);
        return;
      }
      const me = LS.read("ch_user", {});
      const msgs = LS.read("ch_messages", []);
      msgs.push({ id: uid(), author: me.name, authorAvatar: me.avatar || null, text, image: image || null, audio: audio || null, createdAt: now(), parentId, reactions: [] });
      LS.write("ch_messages", msgs);
    },

    async setMessageReaction(messageId, emoji) {
      if (useSupabase) {
        const { data: { user } } = await sb.auth.getUser();
        if (!emoji) {
          await sb.from("message_reactions").delete().eq("message_id", messageId).eq("user_id", user.id);
          return;
        }
        const { error } = await sb.from("message_reactions")
          .upsert({ message_id: messageId, user_id: user.id, reaction: emoji }, { onConflict: "message_id,user_id" });
        if (error) throw new Error(error.message);
        return;
      }
      const me = LS.read("ch_user", {});
      const msgs = LS.read("ch_messages", []);
      const m = msgs.find((x) => x.id === messageId);
      if (!m) return;
      m.reactions = normLikes(m.reactions).filter((l) => l.name !== me.name);
      if (emoji) m.reactions.push({ name: me.name, reaction: emoji });
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

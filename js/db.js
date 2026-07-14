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
  const useSupabase = !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
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

  const uid = () => Math.random().toString(36).slice(2, 10);
  const now = () => new Date().toISOString();
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
        sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
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
        return profile ? { id: user.id, name: profile.display_name, area: profile.area, email: user.email } : null;
      }
      return LS.read("ch_user", null);
    },

    // Demo: join with just a name. Supabase: email + password.
    async signUp({ name, area, email, password }) {
      if (useSupabase) {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw new Error(error.message);
        const { error: pErr } = await sb.from("profiles")
          .insert({ id: data.user.id, display_name: name, area });
        if (pErr) throw new Error(pErr.message);
        return { id: data.user.id, name, area, email };
      }
      const user = { id: uid(), name, area };
      LS.write("ch_user", user);
      return user;
    },

    async signIn({ email, password }) {
      if (useSupabase) {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
        return this.currentUser();
      }
      return null; // demo mode has no sign-in, only join
    },

    async signOut() {
      if (useSupabase) await sb.auth.signOut();
      else localStorage.removeItem("ch_user");
    },

    /* ---------------- Feed / posts ---------------- */

    async getPosts() {
      if (useSupabase) {
        const { data, error } = await sb.from("posts")
          .select("*, profiles(display_name, area), likes(user_id), comments(id, body, created_at, profiles(display_name))")
          .order("created_at", { ascending: false }).limit(100);
        if (error) throw new Error(error.message);
        const { data: { user } } = await sb.auth.getUser();
        return data.map((p) => ({
          id: p.id,
          author: p.profiles?.display_name ?? "Member",
          area: p.profiles?.area ?? "",
          category: p.category,
          text: p.body,
          image: p.image_url,
          createdAt: p.created_at,
          likeCount: p.likes.length,
          likedByMe: user ? p.likes.some((l) => l.user_id === user.id) : false,
          comments: (p.comments ?? [])
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((c) => ({ id: c.id, author: c.profiles?.display_name ?? "Member", text: c.body, createdAt: c.created_at })),
        }));
      }
      const me = LS.read("ch_user", {});
      return LS.read("ch_posts", [])
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((p) => ({
          ...p,
          likeCount: p.likes.length,
          likedByMe: p.likes.includes(me.name),
        }));
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

    async toggleLike(postId) {
      if (useSupabase) {
        const { data: { user } } = await sb.auth.getUser();
        const { data: existing } = await sb.from("likes")
          .select("post_id").eq("post_id", postId).eq("user_id", user.id).maybeSingle();
        if (existing) await sb.from("likes").delete().eq("post_id", postId).eq("user_id", user.id);
        else await sb.from("likes").insert({ post_id: postId, user_id: user.id });
        return;
      }
      const me = LS.read("ch_user", {});
      const posts = LS.read("ch_posts", []);
      const post = posts.find((p) => p.id === postId);
      if (!post) return;
      const i = post.likes.indexOf(me.name);
      if (i >= 0) post.likes.splice(i, 1); else post.likes.push(me.name);
      LS.write("ch_posts", posts);
    },

    async addComment(postId, text) {
      if (useSupabase) {
        const { data: { user } } = await sb.auth.getUser();
        const { error } = await sb.from("comments").insert({ post_id: postId, user_id: user.id, body: text });
        if (error) throw new Error(error.message);
        return;
      }
      const me = LS.read("ch_user", {});
      const posts = LS.read("ch_posts", []);
      const post = posts.find((p) => p.id === postId);
      if (!post) return;
      post.comments.push({ id: uid(), author: me.name, text, createdAt: now() });
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

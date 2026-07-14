/* ============================================================
   UI logic. Renders each view into <main id="view"> and wires
   up events. All user-generated text goes through esc() before
   touching innerHTML.
   ============================================================ */

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const view = $("#view");
  const modalBackdrop = $("#modalBackdrop");
  const modalBody = $("#modalBody");

  let me = null;            // current user {name, area, ...}
  let currentView = "feed";
  let feedFilter = "all";
  let composerImage = null; // data URL (demo) / File (supabase)

  /* ---------------- helpers ---------------- */

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  const catInfo = (id) =>
    CONFIG.CATEGORIES.find((c) => c.id === id) ?? { id, label: id, icon: "📌" };

  const initials = (name) =>
    (name ?? "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 2600);
  }

  function openModal(html) {
    modalBody.innerHTML = html;
    modalBackdrop.hidden = false;
    document.body.classList.add("modal-open");
  }
  function closeModal() {
    modalBackdrop.hidden = true;
    modalBody.innerHTML = "";
    composerImage = null;
    document.body.classList.remove("modal-open");
  }

  /* ---------------- welcome / join screen ---------------- */

  function renderWelcome() {
    document.body.classList.add("no-chrome");
    const demo = DB.mode === "demo";
    view.innerHTML = `
      <div class="welcome">
        <div class="welcome-hero">
          <div class="welcome-mark">${esc(CONFIG.APP_NAME[0])}</div>
          <h1>${esc(CONFIG.APP_NAME)}</h1>
          <p class="welcome-tag">${esc(CONFIG.TAGLINE)}</p>
          <p class="welcome-sub">Sawubona! 👋 Our community's own space — share news, chat with neighbours, and support local businesses.</p>
        </div>
        <form class="welcome-form" id="joinForm">
          <label>Your name
            <input type="text" id="joinName" placeholder="e.g. Thandi Nkosi" required maxlength="40" />
          </label>
          <label>Your area
            <select id="joinArea" required>
              ${CONFIG.AREAS.map((a) => `<option>${esc(a)}</option>`).join("")}
            </select>
          </label>
          ${demo ? "" : `
          <label>Email
            <input type="email" id="joinEmail" placeholder="you@example.com" required />
          </label>
          <label>Password
            <input type="password" id="joinPassword" minlength="6" required />
          </label>`}
          <button type="submit" class="btn-primary btn-block">Join the community →</button>
          ${demo
            ? `<p class="welcome-note">Demo mode: everything is saved on this phone only, so you can explore freely.</p>`
            : `<p class="welcome-note">Already a member? <a href="#" id="showSignIn">Sign in</a></p>`}
        </form>
      </div>`;

    $("#joinForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        me = await DB.signUp({
          name: $("#joinName").value.trim(),
          area: $("#joinArea").value,
          email: $("#joinEmail")?.value.trim(),
          password: $("#joinPassword")?.value,
        });
        enterApp();
      } catch (err) {
        toast(err.message);
      }
    });

    $("#showSignIn")?.addEventListener("click", (e) => {
      e.preventDefault();
      renderSignIn();
    });
  }

  function renderSignIn() {
    view.innerHTML = `
      <div class="welcome">
        <div class="welcome-hero">
          <div class="welcome-mark">${esc(CONFIG.APP_NAME[0])}</div>
          <h1>Welcome back</h1>
        </div>
        <form class="welcome-form" id="signInForm">
          <label>Email <input type="email" id="siEmail" required /></label>
          <label>Password <input type="password" id="siPassword" required /></label>
          <button type="submit" class="btn-primary btn-block">Sign in →</button>
          <p class="welcome-note"><a href="#" id="backToJoin">← New here? Join instead</a></p>
        </form>
      </div>`;
    $("#signInForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        me = await DB.signIn({ email: $("#siEmail").value.trim(), password: $("#siPassword").value });
        if (me) enterApp(); else toast("Could not sign in.");
      } catch (err) { toast(err.message); }
    });
    $("#backToJoin").addEventListener("click", (e) => { e.preventDefault(); renderWelcome(); });
  }

  function enterApp() {
    document.body.classList.remove("no-chrome");
    $("#topAvatar").textContent = initials(me.name);
    switchView("feed");
  }

  /* ---------------- feed ---------------- */

  async function renderFeed() {
    const posts = await DB.getPosts();
    const filtered = feedFilter === "all" ? posts : posts.filter((p) => p.category === feedFilter);

    view.innerHTML = `
      <div class="feed">
        <div class="filter-row">
          <button class="chip ${feedFilter === "all" ? "chip-on" : ""}" data-filter="all">All</button>
          ${CONFIG.CATEGORIES.map((c) =>
            `<button class="chip ${feedFilter === c.id ? "chip-on" : ""}" data-filter="${c.id}">${c.icon} ${esc(c.label)}</button>`
          ).join("")}
        </div>

        <button class="composer-teaser" data-action="compose">
          <span class="avatar">${esc(initials(me.name))}</span>
          <span class="composer-hint">Share something with the community…</span>
        </button>

        ${filtered.length === 0
          ? `<div class="empty">Nothing here yet — be the first to post! 🎈</div>`
          : filtered.map(postCard).join("")}
      </div>`;

    // filter chips
    view.querySelectorAll("[data-filter]").forEach((b) =>
      b.addEventListener("click", () => { feedFilter = b.dataset.filter; renderFeed(); }));

    // like buttons
    view.querySelectorAll("[data-like]").forEach((b) =>
      b.addEventListener("click", async () => {
        await DB.toggleLike(b.dataset.like);
        renderFeed();
      }));

    // toggle comments
    view.querySelectorAll("[data-comments]").forEach((b) =>
      b.addEventListener("click", () => {
        const box = $(`#comments-${b.dataset.comments}`, view);
        box.hidden = !box.hidden;
        if (!box.hidden) $("input", box)?.focus();
      }));

    // comment forms
    view.querySelectorAll("form[data-comment-form]").forEach((f) =>
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = $("input", f);
        const text = input.value.trim();
        if (!text) return;
        await DB.addComment(f.dataset.commentForm, text);
        renderFeed();
      }));
  }

  function postCard(p) {
    const cat = catInfo(p.category);
    return `
      <article class="card post">
        <header class="post-head">
          <span class="avatar">${esc(initials(p.author))}</span>
          <div class="post-meta">
            <div class="post-author">${esc(p.author)}</div>
            <div class="post-sub">${esc(p.area)} · ${timeAgo(p.createdAt)}</div>
          </div>
          <span class="cat-badge cat-${esc(p.category)}">${cat.icon} ${esc(cat.label)}</span>
        </header>
        <p class="post-text">${esc(p.text)}</p>
        ${p.image ? `<img class="post-img" src="${esc(p.image)}" alt="Photo shared by ${esc(p.author)}" loading="lazy" />` : ""}
        <footer class="post-actions">
          <button class="action ${p.likedByMe ? "action-on" : ""}" data-like="${esc(p.id)}">
            👍 <span>${p.likeCount || ""}</span> Like
          </button>
          <button class="action" data-comments="${esc(p.id)}">
            💬 <span>${p.comments.length || ""}</span> Comment
          </button>
        </footer>
        <div class="comments" id="comments-${esc(p.id)}" ${p.comments.length ? "" : "hidden"}>
          ${p.comments.map((c) => `
            <div class="comment">
              <span class="avatar avatar-sm">${esc(initials(c.author))}</span>
              <div class="comment-bubble">
                <span class="comment-author">${esc(c.author)}</span>
                ${esc(c.text)}
              </div>
            </div>`).join("")}
          <form class="comment-form" data-comment-form="${esc(p.id)}">
            <input type="text" placeholder="Write a comment…" maxlength="500" />
            <button type="submit" class="btn-mini">Send</button>
          </form>
        </div>
      </article>`;
  }

  /* ---------------- composer modal ---------------- */

  function openComposer() {
    openModal(`
      <div class="modal-head">
        <h2>New post</h2>
        <button class="modal-close" data-close>✕</button>
      </div>
      <form id="composeForm" class="compose-form">
        <div class="compose-cats">
          ${CONFIG.CATEGORIES.map((c, i) => `
            <label class="chip chip-radio">
              <input type="radio" name="cat" value="${c.id}" ${i === 1 ? "checked" : ""} />
              ${c.icon} ${esc(c.label)}
            </label>`).join("")}
        </div>
        <textarea id="composeText" rows="5" maxlength="2000"
          placeholder="What's happening, ${esc(me.name.split(" ")[0])}?" required></textarea>
        <div class="compose-photo">
          <label class="btn-outline btn-sm">
            📷 Add photo
            <input type="file" id="composePhoto" accept="image/*" hidden />
          </label>
          <span id="photoName" class="photo-name"></span>
        </div>
        <button type="submit" class="btn-primary btn-block">Post to the community</button>
      </form>`);

    $("#composePhoto").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      $("#photoName").textContent = file.name;
      if (DB.mode === "demo") {
        const reader = new FileReader();
        reader.onload = () => (composerImage = reader.result);
        reader.readAsDataURL(file);
      } else {
        composerImage = file;
      }
    });

    $("#composeForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = $("#composeText").value.trim();
      const category = $("input[name=cat]:checked", modalBody).value;
      if (!text) return;
      try {
        await DB.createPost({ text, category, image: composerImage });
        closeModal();
        feedFilter = "all";
        if (currentView !== "feed") switchView("feed"); else renderFeed();
        toast("Posted! 🎉");
      } catch (err) { toast(err.message); }
    });
  }

  /* ---------------- chat ---------------- */

  async function renderChat() {
    const msgs = await DB.getMessages();
    view.innerHTML = `
      <div class="chat">
        <div class="chat-head">
          <h2>Community chat</h2>
          <p>One room for everyone — keep it friendly 💛</p>
        </div>
        <div class="chat-scroll" id="chatScroll">
          ${msgs.map(msgBubble).join("") || `<div class="empty">No messages yet — say sawubona! 👋</div>`}
        </div>
        <form class="chat-form" id="chatForm">
          <input type="text" id="chatInput" placeholder="Type a message…" maxlength="1000" autocomplete="off" />
          <button type="submit" class="btn-primary chat-send">➤</button>
        </form>
      </div>`;

    const scroll = $("#chatScroll");
    scroll.scrollTop = scroll.scrollHeight;

    $("#chatForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = $("#chatInput");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      await DB.sendMessage(text);
      if (currentView === "chat") renderChat();
    });
  }

  function msgBubble(m) {
    const mine = m.author === me.name;
    return `
      <div class="msg ${mine ? "msg-mine" : ""}">
        ${mine ? "" : `<span class="avatar avatar-sm">${esc(initials(m.author))}</span>`}
        <div class="msg-bubble">
          ${mine ? "" : `<span class="msg-author">${esc(m.author)}</span>`}
          ${esc(m.text)}
          <span class="msg-time">${timeAgo(m.createdAt)}</span>
        </div>
      </div>`;
  }

  /* ---------------- business directory ---------------- */

  async function renderMarket() {
    const list = await DB.getBusinesses();
    view.innerHTML = `
      <div class="market">
        <div class="market-head">
          <div>
            <h2>Local businesses</h2>
            <p>Support your neighbours — buy local 🧡</p>
          </div>
          <button class="btn-primary btn-sm" id="addBizBtn">＋ Add yours</button>
        </div>
        ${list.length === 0
          ? `<div class="empty">No businesses listed yet.</div>`
          : list.map((b) => `
            <article class="card biz">
              <div class="biz-top">
                <span class="avatar biz-avatar">${esc(initials(b.name))}</span>
                <div>
                  <div class="biz-name">${esc(b.name)}</div>
                  <div class="biz-sub">${esc(b.category)} · ${esc(b.area)}</div>
                </div>
              </div>
              <p class="biz-desc">${esc(b.description)}</p>
              <div class="biz-actions">
                ${b.phone ? `<a class="btn-outline btn-sm" href="tel:${esc(b.phone.replace(/\s/g, ""))}">📞 Call</a>` : ""}
                ${b.whatsapp ? `<a class="btn-outline btn-sm" target="_blank" rel="noopener"
                    href="https://wa.me/${esc(b.whatsapp.replace(/[^\d]/g, ""))}">💬 WhatsApp</a>` : ""}
              </div>
            </article>`).join("")}
      </div>`;

    $("#addBizBtn").addEventListener("click", openBusinessForm);
  }

  function openBusinessForm() {
    openModal(`
      <div class="modal-head">
        <h2>List your business</h2>
        <button class="modal-close" data-close>✕</button>
      </div>
      <form id="bizForm" class="compose-form">
        <label>Business name <input type="text" id="bizName" required maxlength="60" /></label>
        <label>Category
          <select id="bizCat">
            <option>Food & Drink</option><option>Beauty</option><option>Motor & Repairs</option>
            <option>Building & Trades</option><option>Transport</option><option>Shop / Spaza</option>
            <option>Services</option><option>Other</option>
          </select>
        </label>
        <label>Area
          <select id="bizArea">${CONFIG.AREAS.map((a) => `<option>${esc(a)}</option>`).join("")}</select>
        </label>
        <label>What do you offer? <textarea id="bizDesc" rows="3" maxlength="500" required></textarea></label>
        <label>Phone <input type="tel" id="bizPhone" placeholder="+27 ..." /></label>
        <label>WhatsApp <input type="tel" id="bizWhatsapp" placeholder="+27 ..." /></label>
        <button type="submit" class="btn-primary btn-block">Add to directory</button>
      </form>`);

    $("#bizForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await DB.addBusiness({
          name: $("#bizName").value.trim(),
          category: $("#bizCat").value,
          area: $("#bizArea").value,
          description: $("#bizDesc").value.trim(),
          phone: $("#bizPhone").value.trim(),
          whatsapp: $("#bizWhatsapp").value.trim(),
        });
        closeModal();
        renderMarket();
        toast("Business added! 🏪");
      } catch (err) { toast(err.message); }
    });
  }

  /* ---------------- profile ---------------- */

  function renderProfile() {
    view.innerHTML = `
      <div class="profile">
        <div class="card profile-card">
          <span class="avatar avatar-lg">${esc(initials(me.name))}</span>
          <h2>${esc(me.name)}</h2>
          <p class="profile-sub">${esc(me.area)}${me.email ? ` · ${esc(me.email)}` : ""}</p>
        </div>
        <div class="card about-card">
          <h3>About ${esc(CONFIG.APP_NAME)}</h3>
          <p>${esc(CONFIG.TAGLINE)}. Built by the community, for the community — share news,
          chat with neighbours, and support local businesses.</p>
          <p class="mode-note">${DB.mode === "demo"
            ? "⚠️ Demo mode: your posts are saved on this device only. See README.md to connect the free shared database."
            : "✅ Connected — posts and chat are shared with the whole community."}</p>
        </div>
        <button class="btn-outline btn-block" id="signOutBtn">Sign out</button>
      </div>`;

    $("#signOutBtn").addEventListener("click", async () => {
      await DB.signOut();
      me = null;
      renderWelcome();
    });
  }

  /* ---------------- navigation ---------------- */

  const views = { feed: renderFeed, chat: renderChat, market: renderMarket, profile: renderProfile };

  function switchView(name) {
    currentView = name;
    document.querySelectorAll(".bottomnav .nav-item[data-nav]").forEach((b) =>
      b.classList.toggle("active", b.dataset.nav === name));
    views[name]();
    window.scrollTo(0, 0);
  }

  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav && me) { switchView(nav.dataset.nav); return; }
    const action = e.target.closest("[data-action=compose]");
    if (action && me) { openComposer(); return; }
    if (e.target.closest("[data-close]") || e.target === modalBackdrop) closeModal();
  });

  /* ---------------- boot ---------------- */

  (async () => {
    document.title = `${CONFIG.APP_NAME} – Community Hub`;
    $("#appName").textContent = CONFIG.APP_NAME;
    $("#modePill").hidden = DB.mode !== "demo";

    try {
      await DB.init();
    } catch {
      toast("Could not connect — check your internet or config.");
    }

    // Refresh chat live when someone else sends a message (Supabase mode).
    DB.onNewMessage(() => { if (currentView === "chat") renderChat(); });

    me = await DB.currentUser();
    if (me) enterApp(); else renderWelcome();
  })();
})();

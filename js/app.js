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
          <label>Phone number
            <input type="tel" id="joinPhone" placeholder="e.g. 071 234 5678" required />
          </label>
          <label>Create a PIN (6 or more digits)
            <input type="password" id="joinPassword" inputmode="numeric" minlength="6" required />
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
        const details = {
          name: $("#joinName").value.trim(),
          area: $("#joinArea").value,
          phone: $("#joinPhone")?.value.trim(),
          password: $("#joinPassword")?.value,
        };
        const result = await DB.signUp(details);
        if (result?.needsOtp) { renderOtp(details); return; }
        me = result;
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

  // Members see Sign in first (returning is the common case);
  // joining is one tap away. Demo mode has no accounts, so it keeps the join form.
  function renderAuthLanding() {
    if (DB.mode === "supabase") renderSignIn();
    else renderWelcome();
  }

  // Step 2 of SMS sign-up: the code arrives on the member's phone.
  function renderOtp(details) {
    document.body.classList.add("no-chrome");
    view.innerHTML = `
      <div class="welcome">
        <div class="welcome-hero">
          <div class="welcome-mark">💬</div>
          <h1>Check your SMS</h1>
          <p class="welcome-sub">We sent a code to <strong>${esc(details.phone)}</strong>. Type it below to finish joining.</p>
        </div>
        <form class="welcome-form" id="otpForm">
          <label>SMS code
            <input type="text" id="otpCode" inputmode="numeric" autocomplete="one-time-code"
              maxlength="8" placeholder="e.g. 123456" required />
          </label>
          <button type="submit" class="btn-primary btn-block">Verify →</button>
          <p class="welcome-note">
            No SMS after a minute? <a href="#" id="resendOtp">Send it again</a><br />
            <a href="#" id="otpBack">← Start over</a>
          </p>
        </form>
      </div>`;
    $("#otpCode").focus();

    $("#otpForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        me = await DB.verifyOtp({
          phone: details.phone, token: $("#otpCode").value.trim(),
          name: details.name, area: details.area,
        });
        enterApp();
        toast(`Welcome, ${me.name.split(" ")[0]}! 🎉`);
      } catch (err) { toast(err.message); }
    });
    $("#resendOtp").addEventListener("click", async (e) => {
      e.preventDefault();
      try { await DB.resendOtp(details.phone); toast("New code sent 📲"); }
      catch (err) { toast(err.message); }
    });
    $("#otpBack").addEventListener("click", (e) => { e.preventDefault(); renderWelcome(); });
  }

  // "Forgot PIN": an SMS code proves it's really them, then they pick a new PIN.
  function renderForgotPin() {
    document.body.classList.add("no-chrome");
    view.innerHTML = `
      <div class="welcome">
        <div class="welcome-hero">
          <div class="welcome-mark">🔑</div>
          <h1>Reset your PIN</h1>
          <p class="welcome-sub">We'll SMS a code to your number to make sure it's you.</p>
        </div>
        <form class="welcome-form" id="fpPhoneForm">
          <label>Phone number <input type="tel" id="fpPhone" placeholder="e.g. 071 234 5678" required /></label>
          <button type="submit" class="btn-primary btn-block">SMS me a code →</button>
          <p class="welcome-note"><a href="#" id="fpBack">← Back to sign in</a></p>
        </form>
      </div>`;

    $("#fpBack").addEventListener("click", (e) => { e.preventDefault(); renderSignIn(); });
    $("#fpPhoneForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const phone = $("#fpPhone").value.trim();
      try {
        await DB.requestPinReset(phone);
        view.innerHTML = `
          <div class="welcome">
            <div class="welcome-hero">
              <div class="welcome-mark">💬</div>
              <h1>Check your SMS</h1>
              <p class="welcome-sub">Enter the code we sent to <strong>${esc(phone)}</strong> and choose a new PIN.</p>
            </div>
            <form class="welcome-form" id="fpResetForm">
              <label>SMS code
                <input type="text" id="fpCode" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required />
              </label>
              <label>New PIN (6 or more digits)
                <input type="password" id="fpNewPin" inputmode="numeric" minlength="6" required />
              </label>
              <button type="submit" class="btn-primary btn-block">Save new PIN →</button>
              <p class="welcome-note"><a href="#" id="fpBack2">← Start over</a></p>
            </form>
          </div>`;
        $("#fpBack2").addEventListener("click", (ev) => { ev.preventDefault(); renderForgotPin(); });
        $("#fpResetForm").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          try {
            me = await DB.confirmPinReset({
              phone, token: $("#fpCode").value.trim(), newPin: $("#fpNewPin").value,
            });
            enterApp();
            toast("PIN updated ✔");
          } catch (err) { toast(err.message); }
        });
      } catch (err) { toast(err.message); }
    });
  }

  function renderSignIn() {
    document.body.classList.add("no-chrome");
    view.innerHTML = `
      <div class="welcome">
        <div class="welcome-hero">
          <div class="welcome-mark">${esc(CONFIG.APP_NAME[0])}</div>
          <h1>${esc(CONFIG.APP_NAME)}</h1>
          <p class="welcome-tag">${esc(CONFIG.TAGLINE)}</p>
          <p class="welcome-sub">Sawubona! 👋 Sign in with your phone number.</p>
        </div>
        <form class="welcome-form" id="signInForm">
          <label>Phone number <input type="tel" id="siPhone" placeholder="e.g. 071 234 5678" required /></label>
          <label>PIN <input type="password" id="siPassword" inputmode="numeric" required /></label>
          <button type="submit" class="btn-primary btn-block">Sign in →</button>
          <p class="welcome-note">
            ${DB.supportsOtp ? `<a href="#" id="forgotPin">Forgot your PIN?</a><br />` : ""}
            <a href="#" id="backToJoin">← New here? Join instead</a>
          </p>
        </form>
      </div>`;
    $("#forgotPin")?.addEventListener("click", (e) => { e.preventDefault(); renderForgotPin(); });
    $("#signInForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        me = await DB.signIn({ phone: $("#siPhone").value.trim(), password: $("#siPassword").value });
        if (me) enterApp(); else toast("Could not sign in.");
      } catch (err) { toast(err.message); }
    });
    $("#backToJoin").addEventListener("click", (e) => { e.preventDefault(); renderWelcome(); });
  }

  function enterApp() {
    document.body.classList.remove("no-chrome");
    $("#topAvatar").textContent = initials(me.name);
    const foot = $("#sideFoot");
    if (foot) foot.innerHTML = `${esc(CONFIG.TAGLINE)}<br>Built by the community 💛`;
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

    // react button opens the emoji picker (tap again to close)
    view.querySelectorAll("[data-react-toggle]").forEach((b) =>
      b.addEventListener("click", () => {
        const picker = b.parentElement.querySelector(".react-picker");
        const wasHidden = picker.hidden;
        view.querySelectorAll(".react-picker").forEach((p) => (p.hidden = true));
        picker.hidden = !wasHidden;
      }));

    // choosing an emoji sets my reaction; choosing my current one removes it
    view.querySelectorAll("[data-react]").forEach((b) =>
      b.addEventListener("click", async () => {
        const removing = b.classList.contains("react-current");
        await DB.setReaction(b.dataset.react, removing ? null : b.dataset.emoji);
        renderFeed();
      }));

    // toggle comments
    view.querySelectorAll("[data-comments]").forEach((b) =>
      b.addEventListener("click", () => {
        const box = $(`#comments-${b.dataset.comments}`, view);
        box.hidden = !box.hidden;
        if (!box.hidden) $(".comment-form:not(.reply-form) input", box)?.focus();
      }));

    // "Reply" shows the inline reply box under that comment
    view.querySelectorAll("[data-reply]").forEach((b) =>
      b.addEventListener("click", () => {
        const form = $(`#reply-${b.dataset.reply}`, view);
        form.hidden = !form.hidden;
        if (!form.hidden) $("input", form).focus();
      }));

    // comment + reply forms (a reply carries the parent comment's id)
    view.querySelectorAll("form[data-comment-form]").forEach((f) =>
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = $("input", f);
        const text = input.value.trim();
        if (!text) return;
        await DB.addComment(f.dataset.commentForm, text, f.dataset.parent || null);
        renderFeed();
      }));
  }

  function postCard(p) {
    const cat = catInfo(p.category);
    const reactEntries = Object.entries(p.reactions).sort((a, b) => b[1] - a[1]);
    const reactTotal = reactEntries.reduce((sum, [, n]) => sum + n, 0);
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
        ${reactTotal ? `
        <div class="react-summary">
          <span class="react-faces">${reactEntries.slice(0, 3).map(([e]) => e).join("")}</span> ${reactTotal}
          <span class="react-comments-count">${p.commentCount ? `${p.commentCount} comment${p.commentCount > 1 ? "s" : ""}` : ""}</span>
        </div>` : ""}
        <footer class="post-actions">
          <div class="react-wrap">
            <button class="action ${p.myReaction ? "action-on" : ""}" data-react-toggle="${esc(p.id)}">
              ${p.myReaction ?? "👍"} ${p.myReaction ? "You" : "React"}
            </button>
            <div class="react-picker" hidden>
              ${CONFIG.REACTIONS.map((e) => `
                <button class="react-emoji ${p.myReaction === e ? "react-current" : ""}"
                  data-react="${esc(p.id)}" data-emoji="${e}" title="React ${e}">${e}</button>`).join("")}
            </div>
          </div>
          <button class="action" data-comments="${esc(p.id)}">
            💬 <span>${p.commentCount || ""}</span> Comment
          </button>
        </footer>
        <div class="comments" id="comments-${esc(p.id)}" ${p.comments.length ? "" : "hidden"}>
          ${p.comments.map((c) => commentHtml(p.id, c)).join("")}
          <form class="comment-form" data-comment-form="${esc(p.id)}">
            <input type="text" placeholder="Write a comment…" maxlength="500" />
            <button type="submit" class="btn-mini">Send</button>
          </form>
        </div>
      </article>`;
  }

  function commentHtml(postId, c) {
    return `
      <div class="comment">
        <span class="avatar avatar-sm">${esc(initials(c.author))}</span>
        <div class="comment-body">
          <div class="comment-bubble">
            <span class="comment-author">${esc(c.author)}</span>
            ${esc(c.text)}
          </div>
          <button class="comment-reply-btn" data-reply="${esc(c.id)}">Reply</button>
          ${(c.replies ?? []).map((r) => `
            <div class="comment comment-nested">
              <span class="avatar avatar-sm">${esc(initials(r.author))}</span>
              <div class="comment-bubble">
                <span class="comment-author">${esc(r.author)}</span>
                ${esc(r.text)}
              </div>
            </div>`).join("")}
          <form class="comment-form reply-form" data-comment-form="${esc(postId)}"
            data-parent="${esc(c.id)}" id="reply-${esc(c.id)}" hidden>
            <input type="text" placeholder="Reply to ${esc(c.author.split(" ")[0])}…" maxlength="500" />
            <button type="submit" class="btn-mini">Send</button>
          </form>
        </div>
      </div>`;
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
          <p class="profile-sub">${esc(me.area)}${me.phone ? ` · ${esc(me.phone)}` : ""}</p>
        </div>

        <div class="card account-card">
          <h3>My account</h3>
          <button class="account-row" id="editProfileBtn">
            <span>✏️ Edit name & area</span><span class="account-chev">›</span>
          </button>
          ${DB.mode === "demo" ? "" : `
          <button class="account-row" id="changePinBtn">
            <span>🔑 Change my PIN</span><span class="account-chev">›</span>
          </button>`}
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

    $("#editProfileBtn").addEventListener("click", openEditProfile);
    $("#changePinBtn")?.addEventListener("click", openChangePin);
    $("#signOutBtn").addEventListener("click", async () => {
      await DB.signOut();
      me = null;
      $("#topAvatar").textContent = "?";
      renderAuthLanding();
    });
  }

  function openEditProfile() {
    openModal(`
      <div class="modal-head">
        <h2>Edit profile</h2>
        <button class="modal-close" data-close>✕</button>
      </div>
      <form id="editForm" class="compose-form">
        <label>Your name
          <input type="text" id="editName" value="${esc(me.name)}" maxlength="40" required />
        </label>
        <label>Your area
          <select id="editArea">
            ${CONFIG.AREAS.map((a) => `<option ${a === me.area ? "selected" : ""}>${esc(a)}</option>`).join("")}
          </select>
        </label>
        <button type="submit" class="btn-primary btn-block">Save changes</button>
      </form>`);

    $("#editForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("#editName").value.trim();
      const area = $("#editArea").value;
      if (!name) return;
      try {
        await DB.updateProfile({ name, area });
        me.name = name; me.area = area;
        $("#topAvatar").textContent = initials(name);
        closeModal();
        renderProfile();
        toast("Profile updated ✔");
      } catch (err) { toast(err.message); }
    });
  }

  function openChangePin() {
    openModal(`
      <div class="modal-head">
        <h2>Change my PIN</h2>
        <button class="modal-close" data-close>✕</button>
      </div>
      <form id="pinForm" class="compose-form">
        <label>New PIN (6 or more digits)
          <input type="password" id="newPin" inputmode="numeric" minlength="6" required />
        </label>
        <label>Confirm new PIN
          <input type="password" id="newPin2" inputmode="numeric" minlength="6" required />
        </label>
        <button type="submit" class="btn-primary btn-block">Update PIN</button>
      </form>`);

    $("#pinForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const p1 = $("#newPin").value, p2 = $("#newPin2").value;
      if (p1 !== p2) { toast("The two PINs don't match."); return; }
      try {
        await DB.changePin(p1);
        closeModal();
        toast("PIN updated ✔");
      } catch (err) { toast(err.message); }
    });
  }

  /* ---------------- right rail (desktop) ---------------- */

  async function renderRightRail() {
    const rail = $("#rightRail");
    if (!rail || !me) return;
    try {
      const [biz, posts] = await Promise.all([DB.getBusinesses(), DB.getPosts()]);
      const topBiz = biz.slice(0, 4);
      const events = posts.filter((p) => p.category === "event").slice(0, 3);
      rail.innerHTML = `
        <div class="rail-card">
          <div class="rail-title">🏪 Local businesses</div>
          ${topBiz.length ? topBiz.map((b) => `
            <button class="rail-row" data-nav="market">
              <span class="avatar biz-avatar avatar-sm">${esc(initials(b.name))}</span>
              <span><span class="rail-name">${esc(b.name)}</span>
              <span class="rail-sub">${esc(b.category)} · ${esc(b.area)}</span></span>
            </button>`).join("") : `<div class="rail-empty">No businesses yet.</div>`}
          <button class="rail-more" data-nav="market">See all →</button>
        </div>
        <div class="rail-card">
          <div class="rail-title">🎉 Upcoming events</div>
          ${events.length ? events.map((e) => `
            <button class="rail-row" data-railfilter="event">
              <span><span class="rail-name">${esc(e.author)}</span>
              <span class="rail-sub">${esc(e.text.slice(0, 64))}${e.text.length > 64 ? "…" : ""}</span></span>
            </button>`).join("") : `<div class="rail-empty">Nothing scheduled yet.</div>`}
        </div>`;
    } catch { /* rail is optional; ignore fetch errors */ }
  }

  /* ---------------- navigation ---------------- */

  const views = { feed: renderFeed, chat: renderChat, market: renderMarket, profile: renderProfile };

  function switchView(name) {
    currentView = name;
    document.querySelectorAll(".bottomnav .nav-item[data-nav], .side-item").forEach((b) =>
      b.classList.toggle("active", b.dataset.nav === name));
    views[name]();
    renderRightRail();
    window.scrollTo(0, 0);
  }

  document.addEventListener("click", (e) => {
    const railFilter = e.target.closest("[data-railfilter]");
    if (railFilter && me) { feedFilter = railFilter.dataset.railfilter; switchView("feed"); return; }
    const nav = e.target.closest("[data-nav]");
    if (nav && me) { switchView(nav.dataset.nav); return; }
    const action = e.target.closest("[data-action=compose]");
    if (action && me) { openComposer(); return; }
    if (e.target.closest("[data-close]") || e.target === modalBackdrop) closeModal();
  });

  /* ---------------- PWA install button ---------------- */

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $("#installBtn").hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    $("#installBtn").hidden = true;
  });
  $("#installBtn").addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $("#installBtn").hidden = true;
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

    try {
      me = await DB.currentUser();
    } catch {
      me = null; // e.g. network hiccup during session restore
    }
    if (me) enterApp(); else renderAuthLanding();
  })();
})();

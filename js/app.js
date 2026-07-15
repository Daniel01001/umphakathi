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
  let chatReplyTo = null;   // message being replied to {id, author}
  let chatDraft = "";       // preserve a half-typed message across live re-renders
  const chatTypers = new Map(); // name -> timeout id, for the typing indicator
  let typingBroadcastTimer = null;
  let feedDirty = false;    // a popup changed comments — refresh feed on close
  let chatImage = null;     // pending chat attachment (data URL / File)

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

  // A photo avatar when we have one, otherwise coloured initials.
  function avatarHtml(name, url, extraClass = "") {
    const cls = `avatar ${extraClass}`.trim();
    if (url) return `<span class="${cls} avatar-img"><img src="${esc(url)}" alt="${esc(name)}" loading="lazy" /></span>`;
    return `<span class="${cls}">${esc(initials(name))}</span>`;
  }

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
    if (feedDirty) { feedDirty = false; if (currentView === "feed") renderFeed(); }
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

  // Top-bar avatar: photo if we have one, else initials.
  function setTopAvatar() {
    const el = $("#topAvatar");
    if (!el) return;
    if (me?.avatar) {
      el.classList.add("avatar-img");
      el.innerHTML = `<img src="${esc(me.avatar)}" alt="${esc(me.name)}" />`;
    } else {
      el.classList.remove("avatar-img");
      el.textContent = me ? initials(me.name) : "?";
    }
  }

  function enterApp() {
    document.body.classList.remove("no-chrome");
    setTopAvatar();
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
          ${avatarHtml(me.name, me.avatar)}
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

    // comment like / reply / delete / view-all — shared with the comments popup
    wireCommentActions(view, () => renderFeed());

    // three-dot post menu (own posts)
    view.querySelectorAll("[data-postmenu]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const menu = b.parentElement.querySelector(".post-menu");
        const wasHidden = menu.hidden;
        view.querySelectorAll(".post-menu").forEach((m) => (m.hidden = true));
        menu.hidden = !wasHidden;
      }));
    view.querySelectorAll("[data-delpost]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("Delete this post? This can't be undone.")) return;
        await DB.deletePost(b.dataset.delpost);
        renderFeed();
        toast("Post deleted");
      }));
  }

  function postCard(p) {
    const cat = catInfo(p.category);
    const reactEntries = Object.entries(p.reactions).sort((a, b) => b[1] - a[1]);
    const reactTotal = reactEntries.reduce((sum, [, n]) => sum + n, 0);
    return `
      <article class="card post">
        <header class="post-head">
          ${avatarHtml(p.author, p.authorAvatar)}
          <div class="post-meta">
            <div class="post-author">${esc(p.author)}</div>
            <div class="post-sub">${esc(p.area)} · ${timeAgo(p.createdAt)} · <span class="cat-inline">${cat.icon} ${esc(cat.label)}</span></div>
          </div>
          ${p.mine ? `
          <div class="post-menu-wrap">
            <button class="post-menu-btn" data-postmenu="${esc(p.id)}" aria-label="Post options">⋯</button>
            <div class="post-menu" hidden>
              <button class="post-menu-item" data-delpost="${esc(p.id)}">🗑️ Delete post</button>
            </div>
          </div>` : ""}
        </header>
        <p class="post-text">${esc(p.text)}</p>
        ${p.image ? `<img class="post-img" src="${esc(p.image)}" alt="Photo shared by ${esc(p.author)}" loading="lazy" />` : ""}
        ${reactTotal || p.commentCount ? `
        <div class="react-summary">
          ${reactTotal ? `<span class="react-faces">${reactEntries.slice(0, 3).map(([e]) => e).join("")}</span> ${reactTotal}` : ""}
          <span class="react-comments-count">${p.commentCount ? `${p.commentCount} comment${p.commentCount > 1 ? "s" : ""}` : ""}</span>
        </div>` : ""}
        <footer class="post-actions">
          <div class="react-wrap">
            <button class="action ${p.myReaction ? "action-on" : ""}" data-react-toggle="${esc(p.id)}">
              ${p.myReaction ?? "👍"} ${p.myReaction ? "You" : "Like"}
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
          ${commentsPreviewHtml(p)}
          <form class="comment-form" data-comment-form="${esc(p.id)}">
            ${avatarHtml(me.name, me.avatar, "avatar-sm")}
            <input type="text" placeholder="Write a comment…" maxlength="500" />
            <button type="submit" class="btn-mini">Send</button>
          </form>
        </div>
      </article>`;
  }

  const COMMENT_PREVIEW = 2; // top-level comments shown inline; rest go to the popup

  const countComments = (nodes) =>
    (nodes ?? []).reduce((n, c) => n + 1 + countComments(c.replies), 0);

  // Inline preview: first couple of threads, with a "View all" link to the popup.
  function commentsPreviewHtml(p) {
    const preview = (p.comments ?? []).slice(0, COMMENT_PREVIEW);
    const shown = countComments(preview);
    const more = p.commentCount - shown;
    return `
      ${more > 0 ? `<button class="view-all-comments" data-viewall="${esc(p.id)}">View all ${p.commentCount} comments →</button>` : ""}
      ${preview.map((c) => commentHtml(p.id, c)).join("")}`;
  }

  // Attach comment like/reply/delete/view-all handlers within `root`.
  // `refresh` re-renders whatever surface we're on after a change.
  function wireCommentActions(root, refresh) {
    root.querySelectorAll("[data-clike]").forEach((b) =>
      b.addEventListener("click", async () => {
        await DB.toggleCommentLike(b.dataset.clike);
        refresh();
      }));

    root.querySelectorAll("[data-delcomment]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("Delete this comment?")) return;
        await DB.deleteComment(b.dataset.delcomment);
        refresh();
      }));

    // reply toggle — scoped to this comment (no global ids, so the popup and
    // the feed preview never clash)
    root.querySelectorAll("[data-reply]").forEach((b) =>
      b.addEventListener("click", () => {
        const form = b.closest(".comment-body").querySelector(":scope > .reply-form");
        form.hidden = !form.hidden;
        if (!form.hidden) $("input", form).focus();
      }));

    root.querySelectorAll("form[data-comment-form]").forEach((f) =>
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = $("input", f);
        const text = input.value.trim();
        if (!text) return;
        await DB.addComment(f.dataset.commentForm, text, f.dataset.parent || null);
        refresh();
      }));

    root.querySelectorAll("[data-viewall]").forEach((b) =>
      b.addEventListener("click", () => openCommentsModal(b.dataset.viewall)));
  }

  // Full comments popup — scrollable, handles a post with many comments.
  async function openCommentsModal(postId) {
    const posts = await DB.getPosts();
    const p = posts.find((x) => x.id === postId);
    if (!p) return;
    openModal(`
      <div class="modal-head">
        <h2>${p.commentCount} comment${p.commentCount === 1 ? "" : "s"}</h2>
        <button class="modal-close" data-close>✕</button>
      </div>
      <div class="comments comments-modal" id="modalComments">
        ${(p.comments ?? []).map((c) => commentHtml(p.id, c)).join("") || `<div class="empty">Be the first to comment.</div>`}
      </div>
      <form class="comment-form comment-form-sticky" data-comment-form="${esc(p.id)}">
        ${avatarHtml(me.name, me.avatar, "avatar-sm")}
        <input type="text" placeholder="Write a comment…" maxlength="500" />
        <button type="submit" class="btn-mini">Send</button>
      </form>`);
    feedDirty = true; // refresh the feed once the popup closes
    wireCommentActions(modalBody, () => openCommentsModal(postId));
  }

  // Recursive: a comment renders its own replies, which render theirs, etc.
  // Indentation is capped so deep threads stay readable on a phone.
  function commentHtml(postId, c, depth = 0) {
    const indent = depth > 0 ? "comment-nested" : "";
    return `
      <div class="comment ${indent}">
        ${avatarHtml(c.author, c.authorAvatar, "avatar-sm")}
        <div class="comment-body">
          <div class="comment-bubble">
            <span class="comment-author">${esc(c.author)}</span>
            ${esc(c.text)}
          </div>
          <div class="comment-actions">
            <button class="comment-act ${c.likedByMe ? "liked" : ""}" data-clike="${esc(c.id)}">${c.likedByMe ? "❤️ Liked" : "🤍 Like"}${c.likeCount ? ` · ${c.likeCount}` : ""}</button>
            <button class="comment-act" data-reply="${esc(c.id)}">Reply</button>
            ${c.mine ? `<button class="comment-act comment-del" data-delcomment="${esc(c.id)}">Delete</button>` : ""}
            <span class="comment-time">${timeAgo(c.createdAt)}</span>
          </div>
          <form class="comment-form reply-form" data-comment-form="${esc(postId)}"
            data-parent="${esc(c.id)}" id="reply-${esc(c.id)}" hidden>
            <input type="text" placeholder="Reply to ${esc(c.author.split(" ")[0])}…" maxlength="500" />
            <button type="submit" class="btn-mini">Send</button>
          </form>
          ${(c.replies ?? []).map((r) => commentHtml(postId, r, Math.min(depth + 1, 4))).join("")}
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
    // keep whatever the user was typing when a live update forces a re-render
    const liveInput = $("#chatInput");
    if (liveInput) chatDraft = liveInput.value;

    view.innerHTML = `
      <div class="chat">
        <div class="chat-head">
          <h2>Community chat</h2>
          <p>One room for everyone — keep it friendly 💛</p>
        </div>
        <div class="chat-scroll" id="chatScroll">
          ${renderMessageList(msgs) || `<div class="empty">No messages yet — say sawubona! 👋</div>`}
        </div>
        <div class="typing-row" id="typingRow"></div>
        <div class="reply-bar" id="replyBar" hidden></div>
        <div class="attach-preview" id="attachPreview" hidden></div>
        <form class="chat-form" id="chatForm">
          <label class="chat-attach" title="Send a photo">📎
            <input type="file" id="chatPhoto" accept="image/*" hidden />
          </label>
          <input type="text" id="chatInput" placeholder="Type a message…" maxlength="1000" autocomplete="off" />
          <button type="submit" class="btn-primary chat-send">➤</button>
        </form>
      </div>`;

    const scroll = $("#chatScroll");
    scroll.scrollTop = scroll.scrollHeight;

    const input = $("#chatInput");
    input.value = chatDraft;
    updateReplyBar();
    updateTypingRow();
    updateAttachPreview();

    // attach a photo
    $("#chatPhoto").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      chatImage = DB.mode === "demo" ? await fileToDataUrl(file) : file;
      updateAttachPreview();
    });

    // broadcast "typing" (throttled) while the user writes
    input.addEventListener("input", () => {
      chatDraft = input.value;
      if (!DB.mode || DB.mode !== "supabase") return;
      if (!typingBroadcastTimer) {
        DB.sendTyping(me.name, true);
        typingBroadcastTimer = setTimeout(() => { typingBroadcastTimer = null; }, 1500);
      }
    });

    // message reactions: open picker / choose emoji
    view.querySelectorAll("[data-msgreact-toggle]").forEach((b) =>
      b.addEventListener("click", () => {
        const picker = b.parentElement.querySelector(".react-picker");
        const wasHidden = picker.hidden;
        view.querySelectorAll(".react-picker").forEach((p) => (p.hidden = true));
        picker.hidden = !wasHidden;
      }));
    view.querySelectorAll("[data-msgreact]").forEach((b) =>
      b.addEventListener("click", async () => {
        const removing = b.classList.contains("react-current");
        await DB.setMessageReaction(b.dataset.msgreact, removing ? null : b.dataset.emoji);
        renderChat();
      }));

    // reply to a message (button)
    view.querySelectorAll("[data-msgreply]").forEach((b) =>
      b.addEventListener("click", () => setChatReply(b.dataset.msgreply, msgs, input)));

    // mobile gestures: long-press a bubble to react, swipe left to reply
    wireChatGestures(msgs, input);

    $("#chatForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text && !chatImage) return;
      const image = chatImage;
      input.value = ""; chatDraft = ""; chatImage = null; updateAttachPreview();
      const parentId = chatReplyTo?.id || null;
      chatReplyTo = null; updateReplyBar();
      try {
        await DB.sendMessage(text, parentId, image);
      } catch (err) { toast(err.message); }
      if (currentView === "chat") renderChat();
    });
  }

  function setChatReply(msgId, msgs, input) {
    const m = msgs.find((x) => x.id === msgId);
    chatReplyTo = m ? { id: m.id, author: m.author, text: m.text || "📷 Photo" } : null;
    updateReplyBar();
    input?.focus();
  }

  function updateAttachPreview() {
    const box = $("#attachPreview");
    if (!box) return;
    if (!chatImage) { box.hidden = true; box.innerHTML = ""; return; }
    const src = typeof chatImage === "string" ? chatImage : URL.createObjectURL(chatImage);
    box.hidden = false;
    box.innerHTML = `<img src="${esc(src)}" alt="attachment" /><button class="attach-x" id="attachX">✕</button>`;
    $("#attachX").addEventListener("click", () => { chatImage = null; updateAttachPreview(); });
  }

  // Long-press (~450ms) opens the reaction picker; a left swipe sets a reply.
  function wireChatGestures(msgs, input) {
    view.querySelectorAll(".msg").forEach((el) => {
      const id = el.dataset.msgid;
      let timer = null, startX = 0, startY = 0, moved = false;

      const openReact = () => {
        const picker = el.querySelector(".react-picker");
        if (!picker) return;
        view.querySelectorAll(".react-picker").forEach((p) => (p.hidden = true));
        picker.hidden = false;
      };

      el.addEventListener("pointerdown", (e) => {
        startX = e.clientX; startY = e.clientY; moved = false;
        timer = setTimeout(() => { timer = null; openReact(); }, 450);
      });
      el.addEventListener("pointermove", (e) => {
        if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
          moved = true;
          if (timer) { clearTimeout(timer); timer = null; }
        }
        // follow the finger a little while swiping left
        const dx = e.clientX - startX;
        if (dx < 0 && Math.abs(dx) > Math.abs(e.clientY - startY)) {
          el.style.transform = `translateX(${Math.max(dx, -80)}px)`;
        }
      });
      const end = (e) => {
        if (timer) { clearTimeout(timer); timer = null; }
        const dx = e.clientX - startX;
        el.style.transform = "";
        if (moved && dx < -55 && Math.abs(dx) > Math.abs(e.clientY - startY)) {
          setChatReply(id, msgs, input); // swiped left → reply
        }
      };
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", () => { if (timer) clearTimeout(timer); el.style.transform = ""; });
    });
  }

  // WhatsApp-style: group runs of messages from the same person, and put a
  // date divider whenever the day changes.
  function renderMessageList(msgs) {
    let html = "";
    let prev = null;
    msgs.forEach((m) => {
      const newDay = !prev || new Date(m.createdAt).toDateString() !== new Date(prev.createdAt).toDateString();
      if (newDay) html += `<div class="chat-day"><span>${esc(dayLabel(m.createdAt))}</span></div>`;
      const grouped = !newDay && prev && prev.author === m.author && !m.replyTo &&
        (new Date(m.createdAt) - new Date(prev.createdAt)) < 5 * 60000;
      html += msgBubble(m, grouped);
      prev = m;
    });
    return html;
  }

  function msgBubble(m, grouped = false) {
    const mine = m.mine ?? (m.author === me.name);
    const reactEntries = Object.entries(m.reactions || {}).sort((a, b) => b[1] - a[1]);
    const reactTotal = reactEntries.reduce((s, [, n]) => s + n, 0);
    const hhmm = new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `
      <div class="msg ${mine ? "msg-mine" : ""} ${grouped ? "msg-grouped" : ""}" data-msgid="${esc(m.id)}">
        ${mine ? "" : (grouped ? `<span class="avatar avatar-sm avatar-spacer"></span>` : avatarHtml(m.author, m.authorAvatar, "avatar-sm"))}
        <div class="msg-col">
          <div class="msg-bubble">
            ${m.replyTo ? `<div class="msg-quote"><span class="msg-quote-author">${esc(m.replyTo.author)}</span>${esc((m.replyTo.text || "").slice(0, 80))}</div>` : ""}
            ${mine || grouped ? "" : `<span class="msg-author">${esc(m.author)}</span>`}
            ${m.image ? `<img class="msg-img" src="${esc(m.image)}" alt="Photo" loading="lazy" />` : ""}
            ${m.text ? `<span class="msg-text">${esc(m.text)}</span>` : ""}
            <span class="msg-time">${hhmm}</span>
            ${reactTotal ? `<span class="msg-reacts">${reactEntries.map(([e, n]) => `${e}${n > 1 ? ` ${n}` : ""}`).join("")}</span>` : ""}
          </div>
          <div class="msg-actions">
            <button class="msg-act" data-msgreact-toggle="${esc(m.id)}" title="React">🙂</button>
            <button class="msg-act" data-msgreply="${esc(m.id)}" title="Reply">↩</button>
            <div class="react-picker" hidden>
              ${CONFIG.REACTIONS.map((e) => `
                <button class="react-emoji ${m.myReaction === e ? "react-current" : ""}"
                  data-msgreact="${esc(m.id)}" data-emoji="${e}">${e}</button>`).join("")}
            </div>
          </div>
        </div>
      </div>`;
  }

  function dayLabel(iso) {
    const d = new Date(iso); const today = new Date();
    const yest = new Date(); yest.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yest.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  }

  function updateReplyBar() {
    const bar = $("#replyBar");
    if (!bar) return;
    if (!chatReplyTo) { bar.hidden = true; bar.innerHTML = ""; return; }
    bar.hidden = false;
    bar.innerHTML = `
      <div class="reply-bar-inner">
        <span class="reply-bar-text">↩ Replying to <b>${esc(chatReplyTo.author)}</b>: ${esc((chatReplyTo.text || "").slice(0, 50))}</span>
        <button class="reply-bar-x" id="cancelReply">✕</button>
      </div>`;
    $("#cancelReply").addEventListener("click", () => { chatReplyTo = null; updateReplyBar(); });
  }

  // Someone (not me) is typing — show "X is typing…". Each keystroke refreshes
  // a 3s timer; when it lapses the name drops off.
  function handleTyping({ name, isTyping }) {
    if (!name || name === me?.name) return;
    if (chatTypers.has(name)) clearTimeout(chatTypers.get(name));
    if (isTyping) {
      chatTypers.set(name, setTimeout(() => { chatTypers.delete(name); updateTypingRow(); }, 3000));
    } else {
      chatTypers.delete(name);
    }
    updateTypingRow();
  }

  function updateTypingRow() {
    const row = $("#typingRow");
    if (!row) return;
    const names = [...chatTypers.keys()];
    if (names.length === 0) { row.textContent = ""; return; }
    const who = names.length === 1 ? `${names[0]} is typing`
      : names.length === 2 ? `${names[0]} and ${names[1]} are typing`
      : `${names.length} people are typing`;
    row.innerHTML = `<span class="typing-dots"><i></i><i></i><i></i></span> ${esc(who)}…`;
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
          <button class="avatar-edit" id="avatarBtn" title="Change photo">
            ${avatarHtml(me.name, me.avatar, "avatar-lg")}
            <span class="avatar-edit-badge">📷</span>
          </button>
          <input type="file" id="avatarInput" accept="image/*" hidden />
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
          ${DB.supportsPush ? `
          <div class="account-row account-toggle">
            <span>🔔 Notify me about new posts</span>
            <label class="switch"><input type="checkbox" id="pushToggle" /><span class="slider"></span></label>
          </div>
          <p class="account-hint" id="pushHint"></p>` : ""}
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
    if (DB.supportsPush) setupPushToggle();

    // profile photo upload
    $("#avatarBtn").addEventListener("click", () => $("#avatarInput").click());
    $("#avatarInput").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        toast("Uploading photo…");
        const payload = DB.mode === "demo" ? await fileToDataUrl(file) : file;
        const url = await DB.setAvatar(payload);
        me.avatar = url;
        setTopAvatar();
        renderProfile();
        toast("Photo updated 📷");
      } catch (err) { toast(err.message); }
    });

    $("#signOutBtn").addEventListener("click", async () => {
      await DB.signOut();
      me = null;
      setTopAvatar();
      renderAuthLanding();
    });
  }

  const fileToDataUrl = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej;
    r.readAsDataURL(file);
  });

  /* ---------------- push notifications ---------------- */

  // web-push needs the VAPID key as a Uint8Array, not base64url text.
  function urlBase64ToUint8Array(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  async function setupPushToggle() {
    const toggle = $("#pushToggle");
    const hint = $("#pushHint");
    if (!toggle) return;

    const reg = await navigator.serviceWorker.ready.catch(() => null);
    const existing = reg ? await reg.pushManager.getSubscription() : null;
    const blocked = Notification.permission === "denied";

    toggle.checked = !!existing && Notification.permission === "granted";
    toggle.disabled = blocked;
    if (blocked) hint.textContent = "Notifications are blocked in your phone/browser settings — allow them there to switch this on.";
    else if (toggle.checked) hint.textContent = "On — you'll hear about new posts even when the app is closed.";
    else hint.textContent = "Off — turn on to get a ping when someone posts.";

    toggle.addEventListener("change", async () => {
      try {
        if (toggle.checked) {
          const perm = await Notification.requestPermission();
          if (perm !== "granted") {
            toggle.checked = false;
            hint.textContent = "You didn't allow notifications, so they stay off.";
            return;
          }
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(CONFIG.VAPID_PUBLIC_KEY),
          });
          await DB.savePushSubscription(sub);
          hint.textContent = "On — you'll hear about new posts even when the app is closed.";
          toast("Notifications on 🔔");
        } else {
          const sub = reg ? await reg.pushManager.getSubscription() : null;
          if (sub) { await DB.removePushSubscription(sub.endpoint); await sub.unsubscribe(); }
          hint.textContent = "Off — turn on to get a ping when someone posts.";
          toast("Notifications off");
        }
      } catch (err) {
        toggle.checked = !toggle.checked;
        toast(err.message || "Could not change notifications.");
      }
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
    // close any open pop-overs when clicking away from their trigger
    if (!e.target.closest(".post-menu-wrap"))
      document.querySelectorAll(".post-menu").forEach((m) => (m.hidden = true));
    if (!e.target.closest(".react-wrap") && !e.target.closest(".msg-actions"))
      document.querySelectorAll(".react-picker").forEach((p) => (p.hidden = true));

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
    DB.onTyping(handleTyping);

    try {
      me = await DB.currentUser();
    } catch {
      me = null; // e.g. network hiccup during session restore
    }
    if (me) enterApp(); else renderAuthLanding();
  })();
})();

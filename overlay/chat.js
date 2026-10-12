// overlay/chat.js - Modular LiveChat Overlay Engine for OBS
(function () {
  console.log("💬 [LiveChat] Overlay Engine Initializing...");

  const urlParams = new URLSearchParams(window.location.search);

  // Configuration options from URL
  const CONFIG = {
    showtime: parseShowtime(urlParams.get("showtime")), // ms to fade out, 0 = persistent
    theme: (urlParams.get("theme") || "dark").toLowerCase(),
    size: (urlParams.get("size") || "medium").toLowerCase(),
    align: (urlParams.get("align") || "left").toLowerCase(),
    filterPlatform: (urlParams.get("platform") || "all").toLowerCase(),
    hideBots: urlParams.has("hidebots") || urlParams.get("bots") === "0",
    hideEvents: urlParams.has("hideevents") || urlParams.get("events") === "0",
    maxMessages: parseInt(urlParams.get("max") || "25", 10),
    fontSize: parseInt(urlParams.get("font") || "0", 10),
    chroma: urlParams.get("chroma") || "",
    isTestMode: urlParams.has("test") || urlParams.has("preview")
  };

  function parseShowtime(val) {
    if (!val) return 0;
    const num = parseFloat(val);
    if (isNaN(num) || num <= 0) return 0;
    // If <= 120, treat as seconds, otherwise milliseconds
    return num <= 120 ? num * 1000 : num;
  }

  // State
  let eventSource = null;
  let pollInterval = null;
  let agingInterval = null;
  let lastSender = null;
  let lastPlatform = null;
  let lastMessageContainer = null;
  let lastMessageTimestamp = 0;
  const messageTimestamps = new Map();

  // Platform SVG Icons (Clean, official vector icons)
  const PLATFORM_ICONS = {
    youtube: `
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z" fill="#FF0000"/>
        <polygon points="9.545,15.568 15.818,12 9.545,8.432" fill="#FFFFFF"/>
      </svg>
    `,
    tiktok: `
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M19.589 6.686a4.793 4.793 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-2.883 2.585 2.894 2.894 0 0 1-2.89-2.894 2.895 2.895 0 0 1 2.89-2.894c.32 0 .626.054.914.153V9.083a6.324 6.324 0 0 0-.914-.067c-3.535 0-6.4 2.865-6.4 6.4 0 3.536 2.865 6.4 6.4 6.4a6.38 6.38 0 0 0 6.377-6.075V9.458a8.21 8.21 0 0 0 5.127 1.79V7.785a4.832 4.832 0 0 1-1.406-1.099z" fill="#00F2FE"/>
        <path d="M19.389 6.486a4.793 4.793 0 0 1-3.77-4.245V2h-3.045v13.672a2.896 2.896 0 0 1-2.883 2.585 2.894 2.894 0 0 1-2.89-2.894 2.895 2.895 0 0 1 2.89-2.894c.32 0 .626.054.914.153V9.083a6.324 6.324 0 0 0-.914-.067c-3.535 0-6.4 2.865-6.4 6.4 0 3.536 2.865 6.4 6.4 6.4a6.38 6.38 0 0 0 6.377-6.075V9.458a8.21 8.21 0 0 0 5.127 1.79V7.785a4.832 4.832 0 0 1-1.406-1.099z" fill="#FE2C55" style="mix-blend-mode: screen;"/>
        <path d="M19.189 6.286a4.793 4.793 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-2.883 2.585 2.894 2.894 0 0 1-2.89-2.894 2.895 2.895 0 0 1 2.89-2.894c.32 0 .626.054.914.153V9.083a6.324 6.324 0 0 0-.914-.067c-3.535 0-6.4 2.865-6.4 6.4 0 3.536 2.865 6.4 6.4 6.4a6.38 6.38 0 0 0 6.377-6.075V9.458a8.21 8.21 0 0 0 5.127 1.79V7.785a4.832 4.832 0 0 1-1.406-1.099z" fill="#000000"/>
      </svg>
    `,
    twitch: `
      <svg viewBox="0 0 24 24" fill="#9146FF">
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
      </svg>
    `,
    kick: `
      <svg viewBox="0 0 24 24" fill="#53FC18">
        <path d="M2.5 0h8.75v6.25H15V0h6.5v24H15v-6.25h-3.75V24H2.5z"/>
      </svg>
    `,
    jule: `
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="11" fill="#ec4899"/>
        <path d="M12 4l2.2 4.5 5 .7-3.6 3.5.8 5-4.4-2.3-4.4 2.3.8-5-3.6-3.5 5-.7z" fill="#ffffff"/>
      </svg>
    `,
    simulasi: `
      <svg viewBox="0 0 24 24" fill="#3b82f6">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
    `
  };

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatTime(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }

  function applyStylesAndClasses() {
    const root = document.getElementById("chat-root") || document.body;

    // Apply Theme
    document.body.classList.remove("theme-dark", "theme-glass", "theme-neon", "theme-clean", "theme-minimal");
    document.body.classList.add(`theme-${CONFIG.theme}`);

    // Apply Size
    document.body.classList.remove("size-small", "size-medium", "size-large", "size-xlarge");
    document.body.classList.add(`size-${CONFIG.size}`);

    // Apply Alignment
    document.body.classList.remove("align-left", "align-right");
    document.body.classList.add(`align-${CONFIG.align}`);

    // Custom Font Size
    if (CONFIG.fontSize > 0) {
      document.documentElement.style.fontSize = `${CONFIG.fontSize}px`;
    }

    // Chroma Key solid background
    if (CONFIG.chroma) {
      const col = CONFIG.chroma.startsWith("#") ? CONFIG.chroma : `#${CONFIG.chroma}`;
      document.body.style.backgroundColor = col;
    }
  }

  function getPlatformIcon(platform) {
    const p = (platform || "youtube").toLowerCase();
    return PLATFORM_ICONS[p] || PLATFORM_ICONS.youtube;
  }

  function renderBadges(badges) {
    if (!Array.isArray(badges) || badges.length === 0) return "";
    return badges
      .slice(0, 3)
      .map((b) => {
        let cls = "user-badge-pill ";
        if (b.type === "owner") cls += "badge-owner";
        else if (b.type === "mod") cls += "badge-mod";
        else if (b.type === "member") cls += "badge-member";
        else if (b.type === "bot") cls += "badge-bot";
        else if (b.type === "level") cls += "badge-level";
        else cls += "badge-mod";
        return `<span class="${cls}">${b.icon || ""} ${escapeHtml(b.label || "")}</span>`;
      })
      .join("");
  }

  function isCutOffAtTop(el, container) {
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    return elRect.bottom < containerRect.top;
  }

  function trimCutOffMessages() {
    const container = document.getElementById("chat-container");
    if (!container) return;

    // Remove elements that have completely scrolled above the container view
    while (container.firstElementChild && isCutOffAtTop(container.firstElementChild, container)) {
      const removed = container.firstElementChild;
      messageTimestamps.delete(removed.id);
      container.removeChild(removed);
    }

    // Cap total DOM children to maxMessages
    while (container.children.length > CONFIG.maxMessages) {
      const removed = container.firstElementChild;
      if (!removed) break;
      messageTimestamps.delete(removed.id);
      container.removeChild(removed);
    }
  }

  function autoScroll() {
    const container = document.getElementById("chat-container");
    if (!container) return;

    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
      setTimeout(() => {
        container.scrollTop = container.scrollHeight;
        trimCutOffMessages();
      }, 40);
    });
  }

  /**
   * Add a regular chat message to the overlay
   */
  function addChatMessage(msg) {
    const container = document.getElementById("chat-container");
    if (!container) return;

    const author = msg.author || {};
    const authorName = author.name || "Viewer";
    const platform = (msg.platform || "youtube").toLowerCase();
    const now = Date.now();

    // Check consecutive grouping (same sender within 60s)
    const isConsecutive =
      lastSender === authorName &&
      lastPlatform === platform &&
      lastMessageContainer &&
      lastMessageContainer.isConnected &&
      !lastMessageContainer.classList.contains("fading") &&
      now - lastMessageTimestamp < 60000;

    if (isConsecutive) {
      // Append text inside existing message bubble
      const bubble = lastMessageContainer.querySelector(".message-bubble");
      if (bubble) {
        const extraText = document.createElement("div");
        extraText.className = "message-text-bundled";
        extraText.innerHTML = escapeHtml(msg.message);
        bubble.appendChild(extraText);

        lastMessageTimestamp = now;
        messageTimestamps.set(lastMessageContainer.id, now);
        autoScroll();
        return;
      }
    }

    // Create new message card
    const cardId = msg.id || `msg-${now}-${Math.random().toString(36).slice(2, 6)}`;
    const msgContainer = document.createElement("div");
    msgContainer.className = "message-container";
    msgContainer.id = cardId;

    const iconSvg = getPlatformIcon(platform);
    const badgesHtml = renderBadges(author.badges);
    const timeStr = formatTime(msg.timestamp || now);

    msgContainer.innerHTML = `
      <div class="username-box">
        <span class="platform-icon-wrap">${iconSvg}</span>
        <span class="username-text">${escapeHtml(authorName)}</span>
        <span class="user-badges">${badgesHtml}</span>
      </div>
      <div class="message-bubble">
        <div class="message-text">${escapeHtml(msg.message)}</div>
        <span class="message-time">${timeStr}</span>
      </div>
    `;

    container.appendChild(msgContainer);

    lastSender = authorName;
    lastPlatform = platform;
    lastMessageContainer = msgContainer;
    lastMessageTimestamp = now;
    messageTimestamps.set(cardId, now);

    autoScroll();
  }

  /**
   * Add an event message (Super Chat, TikTok Gift, Follow, Bot Announcement)
   */
  function addEventMessage(eventData) {
    const container = document.getElementById("chat-container");
    if (!container) return;

    const now = Date.now();
    const type = eventData.type || "event";
    const author = eventData.author || {};
    const authorName = author.name || author.displayName || "Viewer";
    const platform = (eventData.platform || "tiktok").toLowerCase();

    const cardId = eventData.id || `evt-${now}-${Math.random().toString(36).slice(2, 6)}`;
    const eventContainer = document.createElement("div");
    eventContainer.className = "message-container";
    eventContainer.id = cardId;

    let eventCls = "event-card ";
    let badgeTitle = "EVENT";
    let badgeIcon = "⚡";
    let detailHtml = "";
    let amountHtml = "";

    if (type === "superchat") {
      eventCls += "event-superchat";
      badgeTitle = "SUPER CHAT";
      badgeIcon = "💰";
      amountHtml = escapeHtml(eventData.amount || "Donasi");
      detailHtml = `<div class="event-detail-text">${escapeHtml(eventData.message || "")}</div>`;
    } else if (type === "gift") {
      eventCls += "event-gift";
      badgeTitle = "TIKTOK GIFT";
      badgeIcon = "🎁";
      amountHtml = escapeHtml(eventData.amount || eventData.giftName || "Gift");
      detailHtml = `<div class="event-detail-text">${escapeHtml(eventData.message || "mengirim hadiah")}</div>`;
    } else if (type === "follow") {
      eventCls += "event-follow";
      badgeTitle = "NEW FOLLOWER";
      badgeIcon = "🌟";
      amountHtml = "FOLLOW";
      detailHtml = `<div class="event-detail-text">Baru saja mengikuti siaran live!</div>`;
    } else if (type === "bot") {
      eventCls += "event-bot";
      badgeTitle = "KAK JULE";
      badgeIcon = "🤖";
      amountHtml = "CO-HOST";
      detailHtml = `<div class="event-detail-text">${escapeHtml(eventData.message || "")}</div>`;
    }

    const iconSvg = getPlatformIcon(platform);

    eventContainer.innerHTML = `
      <div class="${eventCls}">
        <div class="event-header">
          <div class="event-badge-label">
            <span>${badgeIcon}</span>
            <span>${badgeTitle}</span>
          </div>
          <div class="event-amount">${amountHtml}</div>
        </div>
        <div class="event-user-row">
          <span class="platform-icon-wrap">${iconSvg}</span>
          <span>${escapeHtml(authorName)}</span>
        </div>
        ${detailHtml}
      </div>
    `;

    container.appendChild(eventContainer);

    // Reset consecutive grouping on event cards
    lastSender = null;
    lastPlatform = null;
    lastMessageContainer = null;
    lastMessageTimestamp = 0;
    messageTimestamps.set(cardId, now);

    autoScroll();
  }

  /**
   * Router to handle any incoming message packet
   */
  function handleIncomingMessage(data) {
    if (!data) return;

    // Platform filter (?platform=youtube or ?platform=tiktok)
    if (CONFIG.filterPlatform !== "all" && data.platform && data.platform.toLowerCase() !== CONFIG.filterPlatform) {
      return;
    }

    // Hide bots if requested
    if (CONFIG.hideBots && (data.isBot || data.type === "bot" || data.platform === "jule")) {
      return;
    }

    // Hide events if requested
    if (CONFIG.hideEvents && ["superchat", "gift", "follow", "share", "sub"].includes(data.type)) {
      return;
    }

    if (["superchat", "gift", "follow", "share", "sub", "bot"].includes(data.type)) {
      addEventMessage(data);
    } else {
      addChatMessage(data);
    }
  }

  /**
   * Aging timer: auto-hide messages if showtime > 0
   */
  function startAgingTimer() {
    if (CONFIG.showtime <= 0) return;
    if (agingInterval) clearInterval(agingInterval);

    agingInterval = setInterval(() => {
      const now = Date.now();
      const container = document.getElementById("chat-container");
      if (!container) return;

      const items = Array.from(container.children);
      items.forEach((item) => {
        const ts = messageTimestamps.get(item.id);
        if (ts && now - ts > CONFIG.showtime) {
          if (!item.classList.contains("fading")) {
            item.classList.add("fading");
            // Remove from DOM after transition completes
            setTimeout(() => {
              if (item.isConnected) {
                messageTimestamps.delete(item.id);
                item.remove();
              }
            }, 850);
          }
        }
      });
    }, 1000);
  }

  /**
   * Connect to Real-time SSE Stream
   */
  function connectSSE() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    const sseUrl = `/api/chat/stream?ts=${Date.now()}`;
    console.log("📡 [LiveChat] Menghubungkan SSE:", sseUrl);

    try {
      eventSource = new EventSource(sseUrl);

      eventSource.addEventListener("init", (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (Array.isArray(payload.messages)) {
            // Render initial recent messages
            payload.messages.forEach(handleIncomingMessage);
          }
        } catch (err) {
          console.warn("⚠️ [LiveChat] Gagal parse init payload:", err);
        }
      });

      eventSource.addEventListener("message", (e) => {
        try {
          const msg = JSON.parse(e.data);
          handleIncomingMessage(msg);
        } catch (err) {
          console.warn("⚠️ [LiveChat] Gagal parse message data:", err);
        }
      });

      eventSource.addEventListener("clear", () => {
        const container = document.getElementById("chat-container");
        if (container) container.innerHTML = "";
        messageTimestamps.clear();
        lastSender = null;
      });

      eventSource.onerror = () => {
        console.warn("⚠️ [LiveChat] SSE terputus, mencoba fallback polling...");
        eventSource.close();
        eventSource = null;
        startFallbackPolling();
      };
    } catch (err) {
      console.warn("⚠️ [LiveChat] Gagal inisialisasi EventSource:", err);
      startFallbackPolling();
    }
  }

  /**
   * Fallback polling in case SSE is blocked by an exotic browser or proxy
   */
  let lastPolledId = null;
  function startFallbackPolling() {
    if (pollInterval) return;

    pollInterval = setInterval(async () => {
      // If SSE recovered, stop polling
      if (eventSource && eventSource.readyState === EventSource.OPEN) {
        clearInterval(pollInterval);
        pollInterval = null;
        return;
      }

      try {
        const res = await fetch(`/api/chat/recent?limit=15&ts=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.messages)) {
          data.messages.forEach((msg) => {
            if (!messageTimestamps.has(msg.id)) {
              handleIncomingMessage(msg);
            }
          });
        }
      } catch (_) {}
    }, 2000);
  }

  /**
   * In-Browser Test Panel (Enabled with ?test=1 or ?preview=1)
   */
  function setupTestControls() {
    if (!CONFIG.isTestMode) return;

    const bar = document.createElement("div");
    bar.id = "test-controls-bar";
    bar.innerHTML = `
      <span style="font-size: 0.72rem; color: #94a3b8; font-weight: 700;">TEST SIMULATOR:</span>
      <button onclick="window.ChatOverlay.sendTest('youtube', 'chat')">YT Chat</button>
      <button onclick="window.ChatOverlay.sendTest('tiktok', 'chat')">TT Chat</button>
      <button onclick="window.ChatOverlay.sendTest('youtube', 'superchat')">💰 Super Chat</button>
      <button onclick="window.ChatOverlay.sendTest('tiktok', 'gift')">🎁 TT Gift</button>
      <button onclick="window.ChatOverlay.sendTest('tiktok', 'follow')">🌟 Follow</button>
      <button onclick="window.ChatOverlay.sendTest('jule', 'bot')">🤖 Bot</button>
      <button onclick="window.ChatOverlay.clear()" style="background: rgba(239, 68, 68, 0.3);">🗑️ Clear</button>
    `;
    document.body.appendChild(bar);
  }

  // Public Overlay Interface (compatible with overlay/script.js dynamic loader & standalone)
  window.ChatOverlay = {
    init: function () {
      applyStylesAndClasses();
      connectSSE();
      startAgingTimer();
      setupTestControls();
    },

    update: function (state) {
      // Called if integrated into overlay/script.js router
      if (state && state.mode === "chat") {
        autoScroll();
      }
    },

    destroy: function () {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (agingInterval) {
        clearInterval(agingInterval);
        agingInterval = null;
      }
    },

    clear: function () {
      fetch("/api/chat/clear", { method: "POST" }).catch(() => {});
      const container = document.getElementById("chat-container");
      if (container) container.innerHTML = "";
      messageTimestamps.clear();
      lastSender = null;
    },

    sendTest: function (platform = "youtube", type = "chat") {
      let payload = { platform, type };

      if (type === "superchat") {
        payload.authorName = "SuperFan_ID";
        payload.amount = "Rp 50.000";
        payload.message = "Semangat terus live-nya bang! Kak Jule keren banget!";
        payload.isMember = true;
      } else if (type === "gift") {
        payload.authorName = "TikTokViewer";
        payload.giftName = "Singa Sultan";
        payload.repeatCount = 1;
        payload.level = 28;
      } else if (type === "follow") {
        payload.authorName = "NewViewer99";
      } else if (type === "bot") {
        payload.authorName = "Kak Jule";
        payload.message = "Halo semuanya! Selamat datang di live streaming hari ini ya! ✨";
      } else if (platform === "tiktok") {
        payload.authorName = "TikToker_Keren";
        payload.message = "Hadir bang! Kak Jule suara makin jernih aja nih mantap!";
        payload.level = 14;
      } else {
        payload.authorName = "Budi_Gamer";
        payload.message = "Halo Kak Jule dan semuanya! Seru banget gamenya hari ini!";
        payload.isMod = true;
      }

      fetch("/api/chat/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch((e) => console.error("Test send error:", e));
    }
  };

  // Self-boot if loaded directly as standalone page
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      window.ChatOverlay.init();
    });
  } else {
    window.ChatOverlay.init();
  }
})();

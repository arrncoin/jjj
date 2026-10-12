// overlay/sub.js - Kak Jule Live Stream HUD Telemetry Engine (V3.1)

function getBaseServerUrl() {
  if (typeof window !== "undefined" && window.location) {
    const protocol = window.location.protocol;
    if (protocol === "http:" || protocol === "https:") {
      return window.location.origin;
    }
  }
  return "http://127.0.0.1:3000";
}

const SERVER_BASE_URL = getBaseServerUrl();
const SUB_STATS_URL = `${SERVER_BASE_URL}/api/sub-stats`;
const REFRESH_RATE = 30000; // Interval normal 30 detik sesuai ketentuan YouTube Data API v3
const RETRY_WHEN_EMPTY_MS = 3000; // Retry cepat bila belum pernah ada data sama sekali
const RETRY_WHEN_STALE_MS = 15000; // Retry lebih cepat saat data sudah ada tapi baru gagal sinkron

let hasRenderedInitialData = false;
let lastSyncAt = 0;
let lastSyncOk = false;
let pollTimer = null;

/**
 * Update teks elemen DOM secara aman dengan indikator status
 */
function setElementText(id, text, isLive = false, isYt = false) {
  const el = document.getElementById(id);
  if (!el) return;

  if (id === "yt-viewer-count" || id === "tt-viewer-count") {
    const parent = el.closest(".live-item");
    const liveClass = isYt ? "is-live-yt" : "is-live";

    if (isLive && text !== "Offline" && text !== "Error" && text !== "Loading..." && text !== "—") {
      el.innerHTML = `<span class="live-dot"></span>${text}`;
      if (parent) parent.classList.add(liveClass);
    } else {
      el.innerHTML = `<span class="live-dot"></span>${text}`;
      if (parent) parent.classList.remove(liveClass);
    }
  } else {
    el.innerText = text;
  }
}

function formatClock(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch (_) {
    return "";
  }
}

/**
 * Perbarui badge sinkronisasi + penanda data basi agar status "LIVE TELEMETRY" jujur
 * @param {"connecting"|"live"|"stale"|"offline"} status
 */
function updateSyncBadge(status) {
  const badge = document.getElementById("hud-badge-sync");
  const icon = document.getElementById("sync-icon");
  const text = document.getElementById("sync-text");
  const card = document.querySelector(".sub-card");

  if (badge) {
    badge.classList.remove("is-live", "is-stale", "is-offline");
    badge.classList.add(
      status === "live" ? "is-live" :
      status === "stale" ? "is-stale" :
      status === "offline" ? "is-offline" : "is-live"
    );
  }

  // Angka utama diredupkan saat data sudah tidak dapat dipastikan kesegarannya
  const isStale = status === "stale" || status === "offline";
  if (card) card.classList.toggle("is-stale-data", isStale);

  if (icon) {
    icon.textContent =
      status === "live" ? "⚡" :
      status === "stale" ? "⚠" :
      status === "offline" ? "✕" : "…";
  }

  if (text) {
    if (status === "live") {
      const clock = formatClock(lastSyncAt);
      text.textContent = clock ? `SYNC ${clock}` : "Tersinkron";
    } else if (status === "stale") {
      text.textContent = "TERTUNDA";
    } else if (status === "offline") {
      text.textContent = "TIDAK TERSAMBUNG";
    } else {
      text.textContent = "Menghubungkan…";
    }
  }
}

/**
 * Render data statistik strictly dari konfigurasi & hasil sinkronisasi backend
 */
function renderStatsData(data) {
  if (!data) return;

  const yt = data.youtube || {};
  const ch = data.channel || {};
  const tt = data.tiktok || {};

  const subCount = Number(yt.subscribers ?? ch.subscribers ?? 0);
  const views = Number(yt.views ?? ch.views ?? 0);
  const videos = Number(yt.videos ?? ch.videos ?? 0);
  const hiddenSubs = Boolean(yt.hiddenSubscriberCount ?? ch.hiddenSubscriberCount);

  const isConfigured = Boolean(
    data.channelConfig?.channelId ||
    data.channelConfig?.isConfigured ||
    yt.isConfigured ||
    ch.isConfigured ||
    subCount > 0 ||
    views > 0 ||
    videos > 0
  );

  // 0. Nama channel terverifikasi (agar angka dapat dipastikan berasal dari channel yang benar)
  const channelTitle = String(yt.channelTitle || ch.channelTitle || "").trim();
  const titleIsUnknown = !channelTitle || /belum dikonfigurasi/i.test(channelTitle);
  setElementText("channel-name", titleIsUnknown ? "SUBSCRIBERS" : channelTitle);

  // 1. YouTube Subscriber Count
  if (hiddenSubs && subCount <= 0) {
    setElementText("sub-count", "Disembunyikan");
  } else if (subCount > 0) {
    setElementText("sub-count", subCount.toLocaleString("id-ID"));
  } else {
    setElementText("sub-count", isConfigured ? "0" : "—");
  }

  // 2. Target Goal & Persentase
  const targetGoal = Number(yt.targetGoal ?? ch.targetGoal ?? 0);
  const percentage = Number(
    yt.percentage ?? ch.percentage ?? (targetGoal > 0 ? (subCount / targetGoal) * 100 : 0)
  );
  const progressFill = document.getElementById("progress-fill");

  if (targetGoal > 0) {
    setElementText("sub-percentage", `${percentage}% dari ${targetGoal.toLocaleString("id-ID")}`);
    if (progressFill) {
      progressFill.style.width = `${Math.min(percentage, 100)}%`;
    }
  } else {
    setElementText("sub-percentage", isConfigured ? "0% target" : "Belum Disetel");
    if (progressFill) {
      progressFill.style.width = "0%";
    }
  }

  // 3. Total Views
  if (views > 0) {
    setElementText("total-views", views.toLocaleString("id-ID"));
  } else {
    setElementText("total-views", isConfigured ? "0" : "—");
  }

  // 4. Total Videos
  if (videos > 0) {
    setElementText("total-videos", videos.toLocaleString("id-ID"));
  } else {
    setElementText("total-videos", isConfigured ? "0" : "—");
  }

  // 5. YouTube Live Viewers
  if (yt.isLive) {
    const vCount = Number(yt.viewerCount ?? yt.viewers ?? 0);
    const displayText = vCount > 0 ? vCount.toLocaleString("id-ID") : "0";
    setElementText("yt-viewer-count", displayText, true, true);
  } else {
    setElementText("yt-viewer-count", "Offline", false, true);
  }

  // 6. TikTok Live Viewers
  if (tt.isLive) {
    const vCount = Number(tt.viewerCount ?? tt.viewers ?? 0);
    const displayText = vCount > 0 ? vCount.toLocaleString("id-ID") : "0";
    setElementText("tt-viewer-count", displayText, true, false);
  } else {
    setElementText("tt-viewer-count", "Offline", false, false);
  }
}

/**
 * Ambil semua data statistik secara terpadu dari endpoint /api/sub-stats
 */
async function syncAllTelemetry() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(SUB_STATS_URL, {
      cache: "no-store",
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      lastSyncAt = Number(data.updatedAt || Date.now());
      renderStatsData(data);
      hasRenderedInitialData = true;
      updateSyncBadge("live");
      return true;
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn("[Kak Jule HUD] Gagal sinkronisasi telemetri:", err.message);
  }

  // Sinkronisasi gagal
  if (!hasRenderedInitialData) {
    // Belum ada data sama sekali: tampilkan status siaga dan badge "tidak tersambung"
    applyStandbyState();
    updateSyncBadge("offline");
  } else {
    // Data lama tetap tampil, tapi ditandai jelas sebagai tertunda (bukan REALTIME)
    updateSyncBadge("stale");
  }

  return false;
}

/**
 * Tampilkan status siaga jika backend belum merespons
 */
function applyStandbyState() {
  setElementText("channel-name", "SUBSCRIBERS");
  setElementText("sub-count", "—");
  setElementText("sub-percentage", "Siaga");
  setElementText("total-views", "—");
  setElementText("total-videos", "—");
  setElementText("yt-viewer-count", "Offline", false, true);
  setElementText("tt-viewer-count", "Offline", false, false);

  const progressFill = document.getElementById("progress-fill");
  if (progressFill) {
    progressFill.style.width = "0%";
  }

  hasRenderedInitialData = true;
}

/**
 * Penjadwalan polling adaptif (satu loop, tanpa interval ganda):
 * - 30 detik saat sinkronisasi normal (sesuai batas YouTube Data API v3)
 * - 3 detik saat belum pernah berhasil tersambung
 * - 15 detik saat punya data lama tapi sinkronisasi terakhir gagal
 * sehingga server yang hidup kembali cepat terdeteksi, bukan menunggu 30 detik penuh.
 */
function scheduleNextPoll() {
  if (pollTimer) clearTimeout(pollTimer);

  let delay = REFRESH_RATE;
  if (lastSyncAt === 0) {
    delay = RETRY_WHEN_EMPTY_MS;
  } else if (!lastSyncOk) {
    delay = RETRY_WHEN_STALE_MS;
  }

  pollTimer = setTimeout(pollOnce, delay);
}

async function pollOnce() {
  lastSyncOk = await syncAllTelemetry();
  scheduleNextPoll();
}

// 1. Badge langsung menampilkan status "Menghubungkan…" (bukan klaim REALTIME palsu)
updateSyncBadge("connecting");

// 2. Eksekusi sinkronisasi data awal
pollOnce();

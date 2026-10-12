// src/integrations/tiktok/tiktokService.js
// Dedicated TikTok Live Chat Integration Service using official @tiktool/live
const EventEmitter = require("events");
const tiktokViewer = require("./tiktokViewer");
const config = require("../../config");
const logger = require("../../core/logger/logger");
const pointManager = require("../../features/points/pointManager");
const pointRules = require("../../features/points/pointRules");
const { errMsg } = require("../../core/utils/helpers");
const { RETRY_INTERVAL_MS } = require("../../core/constants");

// Import TikTokLive connector that uses `import { TikTokLive } from '@tiktool/live'`
let cachedConnector = null;
async function getTikTokLiveConnector() {
    if (cachedConnector && (cachedConnector.createTikTokLive || cachedConnector.TikTokLive)) {
        return cachedConnector;
    }
    try {
        const mod = await import("./tiktoolConnector.mjs");
        if (mod && (mod.TikTokLive || mod.createTikTokLive)) {
            cachedConnector = mod;
            return mod;
        }
    } catch (err) {
        console.error("❌ [TIKTOK] Gagal memuat modul TikTool connector:", err.message);
        throw err;
    }
    throw new Error("Library @tiktool/live gagal dimuat dari tiktoolConnector.mjs");
}

/**
 * Helper untuk membersihkan dan menstandarkan username akun TikTok dari berbagai format URL / input
 */
function cleanTikTokUsername(raw) {
    if (!raw) return "";
    let clean = String(raw).trim();
    const atMatch = clean.match(/@([a-zA-Z0-9_.-]+)/);
    if (atMatch && atMatch[1]) {
        return atMatch[1].trim();
    }
    const domainMatch = clean.match(/tiktok\.com\/([a-zA-Z0-9_.-]+)/i);
    if (domainMatch && domainMatch[1] && domainMatch[1] !== "live") {
        return domainMatch[1].trim();
    }
    return clean.replace(/^(?:https?:\/\/)?(?:www\.)?tiktok\.com\/?/i, "").replace(/^@/, "").split("/")[0].split("?")[0].trim();
}

/**
 * Helper untuk mengekstrak identitas penonton TikTok secara akurat dari berbagai format event
 */
function extractTikTokUser(data) {
    if (!data || typeof data !== "object") return null;

    const user = data.user || data.sender || data.userDetails || data.author || {};

    let uniqueId =
        data.uniqueId ||
        user.uniqueId ||
        data.displayId ||
        user.displayId ||
        data.userId ||
        user.id ||
        user.userId ||
        data.secUid ||
        user.secUid ||
        "";

    let nickname =
        data.nickname ||
        user.nickname ||
        data.displayName ||
        user.displayName ||
        data.name ||
        user.name ||
        "";

    if (typeof uniqueId === "string") {
        uniqueId = uniqueId.replace(/^@/, "").trim();
    } else if (typeof uniqueId === "number") {
        uniqueId = String(uniqueId);
    } else {
        uniqueId = "";
    }

    if (typeof nickname === "string") {
        nickname = nickname.trim();
    } else if (typeof nickname === "number") {
        nickname = String(nickname);
    } else {
        nickname = "";
    }

    const isDummy = (val) => {
        if (!val) return true;
        const low = String(val).trim().toLowerCase();
        return (
            low === "0" ||
            low === "null" ||
            low === "undefined" ||
            low === "unknown" ||
            low === "pengguna tiktok" ||
            low === "penguna tiktok"
        );
    };

    if (isDummy(uniqueId)) uniqueId = "";
    if (isDummy(nickname)) nickname = "";

    // Isi fallback timbal balik jika salah satu ada
    if (!uniqueId && nickname) uniqueId = nickname;
    if (!nickname && uniqueId) nickname = uniqueId;

    if (!uniqueId && !nickname) {
        return null;
    }

    const badges = data.userBadges || data.level || user.level || user.badges || null;
    const avatar = user.avatarLargeUrl || user.profilePicture || data.avatar || null;

    return {
        uniqueId,
        username: uniqueId,
        displayName: nickname || uniqueId,
        level: badges,
        avatar
    };
}

class TikTokService extends EventEmitter {
    constructor() {
        super();
        this.tiktokLive = null;
        this.isConnected = false;
        this.isStarting = false;
        this.isStopped = true;
        this.activeMode = "relayed";
        this.viewerCount = 0;
        this.lastError = null;
        this.retryTimeout = null;
        this.handshakeTimeout = null;
        this.onChatHandler = null;
    }

    setChatHandler(handler) {
        this.onChatHandler = handler;
    }

    handleFollow(user) {
        try {
            const userObj = {
                platform: "tiktok",
                platformUserId: user.uniqueId,
                username: user.username,
                displayName: user.displayName
            };

            pointManager.addPoints(userObj, pointRules.POINTS.FOLLOW || 50, "follow", "Follow akun TikTok live");
            logger.chat(`🌟 ${user.displayName} (@${user.uniqueId}) mem-follow siaran (+50 poin)!`, {
                platform: "tiktok",
                author: user.displayName
            });
            this.emit("follow", {
                platform: "tiktok",
                author: user
            });
        } catch (e) {
            console.warn("⚠️ Error processing TikTok follow event:", e.message);
        }
    }

    handleShare(user) {
        try {
            const userObj = {
                platform: "tiktok",
                platformUserId: user.uniqueId,
                username: user.username,
                displayName: user.displayName
            };

            if (pointManager.canReceivePoints(userObj, "share")) {
                pointManager.addPoints(userObj, pointRules.POINTS.SHARE || 10, "share", "Bagikan siaran live TikTok");
                logger.chat(`🔁 ${user.displayName} (@${user.uniqueId}) membagikan siaran live (+10 poin)!`, {
                    platform: "tiktok",
                    author: user.displayName
                });
            }
        } catch (e) {
            console.warn("⚠️ Error processing TikTok share event:", e.message);
        }
    }

    async initClient(mode = "relayed") {
        const username = cleanTikTokUsername(config.tiktokUsername);
        const apiKey = (config.tiktoolsApiKey || "").trim();

        if (!username) {
            console.log("⚠️ TIKTOK_USERNAME kosong, konektor TikTok tidak aktif.");
            return false;
        }

        if (!apiKey) {
            console.log("ℹ️ TIKTOOLS_API_KEY belum diisi. Masukkan API Key TikTools dari https://tik.tools pada menu Pengaturan.");
            return false;
        }

        // Bersihkan instance lama agar tidak terjadi memory leak atau tumpang tindih event
        if (this.tiktokLive) {
            try {
                if (typeof this.tiktokLive.destroy === "function") {
                    this.tiktokLive.destroy();
                } else if (typeof this.tiktokLive.disconnect === "function") {
                    this.tiktokLive.disconnect();
                }
                if (typeof this.tiktokLive.removeAllListeners === "function") {
                    this.tiktokLive.removeAllListeners();
                }
            } catch (_) {}
            this.tiktokLive = null;
        }

        try {
            const connector = await getTikTokLiveConnector();
            this.activeMode = mode;

            // Inisialisasi client TikTokLive resmi dari @tiktool/live
            const createFn = connector.createTikTokLive || ((opts) => new connector.TikTokLive(opts));
            this.tiktokLive = createFn({
                uniqueId: username,
                apiKey: apiKey,
                mode: mode,
                autoReconnect: true,
                maxReconnectAttempts: 10
            });

            // Handshake verification: TikTools WebSocket emits 'connected' as soon as TCP opens.
            // Verifikasi apakah socket tetap aktif setelah TCP handshake.
            this.tiktokLive.on("connected", () => {
                if (this.isStopped) {
                    try { this.tiktokLive.disconnect(); } catch (_) {}
                    return;
                }

                if (this.handshakeTimeout) clearTimeout(this.handshakeTimeout);
                this.handshakeTimeout = setTimeout(() => {
                    if (!this.isStopped && this.tiktokLive && this.tiktokLive.connected !== false) {
                        console.log(`✅ [TIKTOK] Terhubung ke siaran live @${username} (Jalur: ${mode.toUpperCase()} TikTools)`);
                        logger.tiktok(`✅ [TIKTOK] Terhubung ke livechat @${username} (Mode: ${mode.toUpperCase()})`);
                        this.isConnected = true;
                        this.isStarting = false;
                        this.lastError = null;
                        tiktokViewer.writeState({ isLive: true });
                        this.emit("connected");
                    }
                }, 300);
            });

            this.tiktokLive.on("roomInfo", (info) => {
                if (this.isStopped) return;
                this.isConnected = true;
                this.isStarting = false;
                this.lastError = null;
                tiktokViewer.writeState({ isLive: true });
                this.emit("roomInfo", info);
            });

            this.tiktokLive.on("roomUserSeq", (data) => {
                if (this.isStopped) return;
                const count = Number(data?.viewerCount ?? data?.memberCount ?? 0);
                this.viewerCount = count;
                this.isConnected = true;
                this.isStarting = false;
                this.lastError = null;
                tiktokViewer.writeState({ isLive: true, viewerCount: count });
                this.emit("viewers", count);
            });

            this.tiktokLive.on("streamEnd", () => {
                if (this.isStopped) return;
                console.log("🔚 [TIKTOK] Siaran live telah berakhir.");
                tiktokViewer.writeState({ isLive: false, viewerCount: 0 });
                this.isConnected = false;
                this.isStarting = false;
                this.emit("streamEnd");
            });

            // Penanganan Live Chat Instan
            this.tiktokLive.on("chat", (data) => {
                if (this.isStopped) return;

                const user = extractTikTokUser(data);
                if (!user) return;

                const message = (data.comment || data.message || data.text || "").trim();
                if (!message) return;

                const payload = {
                    platform: "tiktok",
                    author: {
                        name: user.displayName,
                        uniqueId: user.uniqueId,
                        level: user.level,
                        avatar: user.avatar
                    },
                    cleanMessage: message,
                    timestamp: Date.now(),
                };

                this.emit("chat", payload);
                if (typeof this.onChatHandler === "function") {
                    this.onChatHandler(payload);
                }
            });

            // Penanganan Gift
            this.tiktokLive.on("gift", (data) => {
                if (this.isStopped) return;
                try {
                    const user = extractTikTokUser(data);
                    if (!user) return;

                    const giftName = data.giftName || data.giftDetails?.giftName || "Hadiah";
                    const repeatCount = Number(data.repeatCount || 1);
                    const diamondCount = Number(data.diamondCount || 1);
                    const pts = Math.max(20, diamondCount * 5);

                    pointManager.addPoints(
                        {
                            platform: "tiktok",
                            platformUserId: user.uniqueId,
                            username: user.username,
                            displayName: user.displayName
                        },
                        pts,
                        "gift",
                        `Kirim gift TikTok: ${giftName} x${repeatCount}`
                    );
                    logger.chat(`🎁 ${user.displayName} (@${user.uniqueId}) mengirim ${giftName} (+${pts} poin)!`, {
                        platform: "tiktok",
                        author: user.displayName
                    });
                    this.emit("gift", {
                        platform: "tiktok",
                        author: user,
                        giftName,
                        repeatCount,
                        diamondCount
                    });
                } catch (e) {
                    console.warn("⚠️ Error processing TikTok gift event:", e.message);
                }
            });

            // Penanganan Like
            this.tiktokLive.on("like", (data) => {
                if (this.isStopped) return;
                try {
                    const user = extractTikTokUser(data);
                    if (!user) return;

                    const userObj = {
                        platform: "tiktok",
                        platformUserId: user.uniqueId,
                        username: user.username,
                        displayName: user.displayName
                    };

                    if (pointManager.canReceivePoints(userObj, "like")) {
                        pointManager.addPoints(userObj, pointRules.POINTS.LIKE || 1, "like", "Like siaran live TikTok");
                    }
                } catch (e) {
                    console.warn("⚠️ Error processing TikTok like event:", e.message);
                }
            });

            // Penanganan Social Events (Follow / Share)
            this.tiktokLive.on("social", (data) => {
                if (this.isStopped) return;
                const user = extractTikTokUser(data);
                if (!user) return;

                const action = String(data.action || "").toLowerCase();
                if (action.includes("follow")) {
                    this.handleFollow(user);
                } else if (action.includes("share")) {
                    this.handleShare(user);
                }
            });

            this.tiktokLive.on("follow", (data) => {
                if (this.isStopped) return;
                const user = extractTikTokUser(data);
                if (user) this.handleFollow(user);
            });

            this.tiktokLive.on("share", (data) => {
                if (this.isStopped) return;
                const user = extractTikTokUser(data);
                if (user) this.handleShare(user);
            });

            this.tiktokLive.on("member", (data) => {
                if (this.isStopped) return;
                const user = extractTikTokUser(data);
                if (user) {
                    this.emit("member", { platform: "tiktok", author: user });
                }
            });

            this.tiktokLive.on("disconnected", (code, reason) => {
                if (this.handshakeTimeout) {
                    clearTimeout(this.handshakeTimeout);
                    this.handshakeTimeout = null;
                }
                this.isConnected = false;
                this.isStarting = false;
                tiktokViewer.writeState({ isLive: false, viewerCount: 0 });

                if (this.isStopped) return;

                const reasonStr = String(reason || "");
                console.log(`🔚 [TIKTOK] Live terputus. Kode: ${code || "N/A"}, Alasan: ${reasonStr || "N/A"}`);

                // Evaluasi close codes dari TikTools
                if (code === 4401 || reasonStr.includes("Evaluation period ended")) {
                    this.lastError = "API Key TikTools kedaluwarsa (Evaluation period ended). Silakan perbarui di https://tik.tools/pricing";
                    logger.error(`❌ [TIKTOK] API Key TikTools kedaluwarsa (Evaluation period ended). Kunjungi https://tik.tools/pricing untuk memperbarui.`);
                    if (this.tiktokLive && typeof this.tiktokLive.disconnect === "function") {
                        try { this.tiktokLive.disconnect(); } catch (_) {}
                    }
                    this.emit("disconnected", { code, reason: this.lastError });
                    return; // Hentikan auto-retry loop jika key kedaluwarsa
                }

                if (code === 4403 || reasonStr.includes("Invalid API key")) {
                    this.lastError = "API Key TikTools tidak valid. Periksa kembali di menu Pengaturan.";
                    logger.error(`❌ [TIKTOK] ${this.lastError}`);
                    if (this.tiktokLive && typeof this.tiktokLive.disconnect === "function") {
                        try { this.tiktokLive.disconnect(); } catch (_) {}
                    }
                    this.emit("disconnected", { code, reason: this.lastError });
                    return; // Hentikan auto-retry loop jika key salah
                }

                if (code === 4404 || reasonStr.toLowerCase().includes("not currently live") || reasonStr.toLowerCase().includes("not live") || reasonStr.toLowerCase().includes("offline")) {
                    this.lastError = "Akun belum live (Siaga)";
                    logger.info(`😴 [TIKTOK] Akun @${username} saat ini sedang offline (belum memulai live). Bot dalam mode siaga.`);
                    this.emit("disconnected", { code, reason: this.lastError });
                    this.scheduleRetry();
                    return;
                }

                this.lastError = reasonStr || "Koneksi terputus";
                this.emit("disconnected", { code, reason: reasonStr });
                this.scheduleRetry();
            });

            this.tiktokLive.on("error", (err) => {
                if (this.handshakeTimeout) {
                    clearTimeout(this.handshakeTimeout);
                    this.handshakeTimeout = null;
                }
                this.isConnected = false;
                this.isStarting = false;
                tiktokViewer.writeState({ isLive: false, viewerCount: 0 });

                if (this.isStopped) return;
                const errorText = errMsg(err);
                console.warn(`⚠️ [TIKTOK] Info Koneksi (${mode}):`, errorText);
                this.lastError = errorText;

                if (errorText.includes("Evaluation period ended")) {
                    this.lastError = "API Key TikTools kedaluwarsa (Evaluation period ended). Perbarui di https://tik.tools/pricing";
                    logger.error(`❌ [TIKTOK] ${this.lastError}`);
                    return;
                }

                this.emit("error", err);
                this.scheduleRetry();
            });

            return true;
        } catch (err) {
            this.isStarting = false;
            this.isConnected = false;
            console.error("❌ Gagal menginisialisasi TikTok connector:", errMsg(err));
            return false;
        }
    }

    setup() {
        this.disconnect();
        return true;
    }

    async connect() {
        this.isStopped = false;

        const username = cleanTikTokUsername(config.tiktokUsername);
        const apiKey = (config.tiktoolsApiKey || "").trim();

        if (!username) {
            console.log("⚠️ [TIKTOK] Username TikTok belum diisi.");
            this.lastError = "Username TikTok belum diisi";
            return;
        }

        if (!apiKey) {
            this.lastError = "API Key TikTools belum diisi";
            logger.warn("⚠️ [TIKTOK] API Key TikTools belum dikonfigurasi di Pengaturan.");
            return;
        }

        if (this.isConnected) return;

        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }

        this.isStarting = true;
        this.lastError = null;

        console.log(`🔄 [TIKTOK] Menghubungkan ke live @${username} via TikTools (Relayed Mode)...`);
        logger.info(`🔄 [TIKTOK] Menghubungkan ke livechat @${username}...`);

        try {
            const ready = await this.initClient("relayed");
            if (!ready || this.isStopped) {
                this.isStarting = false;
                return;
            }

            await this.tiktokLive.connect();

            if (this.isStopped) {
                this.disconnect();
                return;
            }
        } catch (errRelay) {
            if (this.isStopped) {
                this.isStarting = false;
                return;
            }

            const relayErr = errMsg(errRelay);
            console.warn(`⚠️ [TIKTOK] Jalur Relayed error: ${relayErr}`);
            this.isConnected = false;
            this.isStarting = false;
            this.lastError = relayErr;

            if (relayErr.includes("Evaluation period ended")) {
                this.lastError = "API Key TikTools kedaluwarsa (Evaluation period ended).";
                logger.error("❌ [TIKTOK] API Key TikTools kedaluwarsa. Kunjungi https://tik.tools/pricing untuk memperbarui.");
                return;
            }

            if (relayErr.toLowerCase().includes("not currently live") || relayErr.toLowerCase().includes("not live")) {
                this.lastError = "Akun belum live (Siaga)";
                logger.info(`😴 [TIKTOK] Akun @${username} belum live. Bot dalam mode siaga.`);
                this.scheduleRetry();
                return;
            }

            this.scheduleRetry();
        }
    }

    disconnect() {
        this.isStopped = true;
        if (this.handshakeTimeout) {
            clearTimeout(this.handshakeTimeout);
            this.handshakeTimeout = null;
        }
        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }
        tiktokViewer.writeState({ isLive: false, viewerCount: 0 });
        if (this.tiktokLive) {
            try {
                if (typeof this.tiktokLive.destroy === "function") {
                    this.tiktokLive.destroy();
                } else if (typeof this.tiktokLive.disconnect === "function") {
                    this.tiktokLive.disconnect();
                }
                if (typeof this.tiktokLive.removeAllListeners === "function") {
                    this.tiktokLive.removeAllListeners();
                }
            } catch (_) {}
            this.tiktokLive = null;
        }
        this.isConnected = false;
        this.isStarting = false;
        this.lastError = null;
        this.emit("disconnected");
    }

    scheduleRetry() {
        if (this.isStopped) {
            if (this.retryTimeout) {
                clearTimeout(this.retryTimeout);
                this.retryTimeout = null;
            }
            return;
        }
        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }
        this.retryTimeout = setTimeout(() => {
            this.retryTimeout = null;
            if (!this.isStopped) {
                this.connect();
            }
        }, RETRY_INTERVAL_MS);
    }

    getStatus() {
        const ttUser = cleanTikTokUsername(config.tiktokUsername);
        const ttKey = config.tiktoolsApiKey;

        if (this.isStopped) {
            return {
                configured: Boolean(ttUser),
                username: ttUser,
                hasApiKey: Boolean(ttKey),
                connected: false,
                starting: false,
                isLive: false,
                viewerCount: 0,
                lastError: null
            };
        }

        return {
            configured: Boolean(ttUser),
            username: ttUser,
            hasApiKey: Boolean(ttKey),
            connected: this.isConnected,
            starting: this.isStarting,
            isLive: Boolean((tiktokViewer && tiktokViewer.getState().isLive) || this.isConnected),
            viewerCount: this.viewerCount || (tiktokViewer ? tiktokViewer.getState().viewerCount || 0 : 0),
            lastError: this.lastError
        };
    }
}

module.exports = new TikTokService();

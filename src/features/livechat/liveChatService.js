// src/features/livechat/liveChatService.js
// Modular Real-Time Live Chat Service for YouTube, TikTok & Multi-Platform OBS Overlays
const EventEmitter = require("events");

class LiveChatService extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(Infinity);
        this.messages = []; // In-memory ring buffer of recent chats & events
        this.maxBuffer = 80;
        this.clients = new Set(); // Active SSE subscriber connections
        this.heartbeatTimer = null;
        this.lastDedupeMap = new Map(); // key -> timestamp for deduplication

        this._startHeartbeat();
    }

    _startHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
            if (this.clients.size === 0) return;
            const pingPayload = `: ping ${Date.now()}\n\n`;
            for (const client of this.clients) {
                try {
                    client.write(pingPayload);
                } catch (_) {
                    this.clients.delete(client);
                }
            }
        }, 20000);
    }

    _generateId() {
        return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }

    /**
     * Compute a consistent avatar background color from author name
     */
    _computeAvatarColor(name) {
        if (!name) return "#6366f1";
        const palette = [
            "#ef4444", "#f97316", "#f59e0b", "#10b981", 
            "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", 
            "#ec4899", "#14b8a6", "#e11d48", "#0284c7"
        ];
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        return palette[Math.abs(hash) % palette.length];
    }

    /**
     * Check if a message is a rapid duplicate (e.g. cross-platform relay echo)
     */
    _isDuplicate(authorName, text, platform) {
        const key = `${platform}:${(authorName || "").toLowerCase()}:${(text || "").trim()}`;
        const now = Date.now();
        const prev = this.lastDedupeMap.get(key);
        if (prev && (now - prev) < 1200) {
            return true;
        }
        this.lastDedupeMap.set(key, now);

        // Periodically purge old dedupe keys
        if (this.lastDedupeMap.size > 200) {
            const cutoff = now - 15000;
            for (const [k, ts] of this.lastDedupeMap.entries()) {
                if (ts < cutoff) this.lastDedupeMap.delete(k);
            }
        }
        return false;
    }

    /**
     * Normalize badges from different platforms
     */
    _normalizeBadges(author = {}, platform = "youtube") {
        const badges = [];

        if (author.isOwner || author.isChatOwner) {
            badges.push({ type: "owner", label: "Owner", icon: "👑", color: "#f59e0b" });
        }
        if (author.isAdmin || author.isModerator || author.isChatModerator) {
            badges.push({ type: "mod", label: "Mod", icon: "🛡️", color: "#3b82f6" });
        }
        if (author.isMember || author.isSponsor) {
            badges.push({ type: "member", label: "Member", icon: "⭐", color: "#10b981" });
        }
        if (author.isVerified) {
            badges.push({ type: "verified", label: "Verified", icon: "✓", color: "#06b6d4" });
        }
        if (author.level) {
            badges.push({ type: "level", label: `Lv.${author.level}`, icon: "⚡", color: "#ec4899" });
        }

        return badges;
    }

    /**
     * Ingest and broadcast a message from any platform
     */
    addMessage(payload) {
        if (!payload) return null;

        const rawText = (payload.cleanMessage || payload.message || payload.text || "").trim();
        const type = payload.type || (payload.isSuperChat ? "superchat" : "chat");
        const authorName = (payload.author?.name || payload.author?.displayName || payload.author?.username || "Viewer").trim();
        const platform = (payload.platform || "system").toLowerCase();

        // Allow event messages even if text is empty (e.g. gift or follow)
        if (!rawText && type === "chat") return null;

        // Skip duplicates within 1.2s
        if (type === "chat" && this._isDuplicate(authorName, rawText, platform)) {
            return null;
        }

        const authorObj = payload.author || {};
        const badges = authorObj.badges || this._normalizeBadges(authorObj, platform);
        const avatarColor = authorObj.color || this._computeAvatarColor(authorName);

        const normalized = {
            id: payload.id || this._generateId(),
            platform, // "youtube", "tiktok", "twitch", "kick", "jule", "simulasi"
            type,     // "chat", "superchat", "gift", "follow", "share", "sub", "bot"
            author: {
                name: authorName,
                username: authorObj.uniqueId || authorObj.username || authorName,
                channelId: authorObj.channelId || null,
                uniqueId: authorObj.uniqueId || null,
                avatar: authorObj.avatar || null,
                color: avatarColor,
                isOwner: Boolean(authorObj.isOwner || authorObj.isChatOwner),
                isAdmin: Boolean(authorObj.isAdmin || authorObj.isModerator || authorObj.isChatModerator),
                isModerator: Boolean(authorObj.isModerator || authorObj.isChatModerator),
                isMember: Boolean(authorObj.isMember || authorObj.isSponsor),
                level: authorObj.level || null,
                badges
            },
            message: rawText,
            amount: payload.amount || payload.purchaseAmount || null,
            giftName: payload.giftName || null,
            repeatCount: Number(payload.repeatCount || 1),
            timestamp: payload.timestamp || Date.now(),
            isBot: Boolean(payload.isBot || platform === "jule")
        };

        // Push to ring buffer
        this.messages.push(normalized);
        if (this.messages.length > this.maxBuffer) {
            this.messages.shift();
        }

        // Broadcast to SSE clients
        this._broadcastToClients("message", normalized);

        // Internal event
        this.emit("message", normalized);

        return normalized;
    }

    /**
     * Bridge method for incoming chat from botManager or platform services
     */
    onIncomingChat(chatItem) {
        if (!chatItem) return;
        return this.addMessage({
            platform: chatItem.platform || "youtube",
            type: chatItem.isSuperChat ? "superchat" : "chat",
            author: chatItem.author,
            cleanMessage: chatItem.cleanMessage || chatItem.message,
            amount: chatItem.purchaseAmount,
            timestamp: chatItem.timestamp || Date.now()
        });
    }

    /**
     * Bridge method for Kak Jule bot AI responses
     */
    onBotResponse(responseText, contextUser = "") {
        if (!responseText || !responseText.trim()) return;
        return this.addMessage({
            platform: "jule",
            type: "bot",
            isBot: true,
            author: {
                name: "Kak Jule",
                username: "kak_jule_bot",
                isOwner: false,
                isAdmin: true,
                badges: [
                    { type: "bot", label: "AI Co-Host", icon: "🤖", color: "#ec4899" }
                ],
                color: "#ec4899"
            },
            cleanMessage: responseText.trim(),
            timestamp: Date.now()
        });
    }

    /**
     * Bridge method for gift events (TikTok gifts, YouTube Super Stickers)
     */
    onGift(giftPayload) {
        if (!giftPayload) return;
        const author = giftPayload.author || {};
        return this.addMessage({
            platform: giftPayload.platform || "tiktok",
            type: "gift",
            author: {
                name: author.displayName || author.name || "Viewer",
                uniqueId: author.uniqueId || author.username || "viewer",
                level: author.level || null
            },
            giftName: giftPayload.giftName || "Hadiah",
            amount: giftPayload.repeatCount ? `${giftPayload.giftName} x${giftPayload.repeatCount}` : giftPayload.amount || "Gift",
            repeatCount: giftPayload.repeatCount || 1,
            cleanMessage: giftPayload.message || `mengirim ${giftPayload.giftName || "hadiah"}!`,
            timestamp: Date.now()
        });
    }

    /**
     * Bridge method for follow / sub events
     */
    onFollow(followPayload) {
        if (!followPayload) return;
        const author = followPayload.author || {};
        return this.addMessage({
            platform: followPayload.platform || "tiktok",
            type: "follow",
            author: {
                name: author.displayName || author.name || "Viewer",
                uniqueId: author.uniqueId || author.username || "viewer"
            },
            cleanMessage: "baru saja mem-follow live!",
            timestamp: Date.now()
        });
    }

    /**
     * Broadcast an SSE packet to all connected clients
     */
    _broadcastToClients(eventType, data) {
        if (this.clients.size === 0) return;
        const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const client of this.clients) {
            try {
                client.write(payload);
            } catch (_) {
                this.clients.delete(client);
            }
        }
    }

    /**
     * Return recent messages
     */
    getRecent(limit = 40) {
        const count = Math.min(Math.max(1, limit), this.messages.length);
        return this.messages.slice(-count);
    }

    /**
     * Clear buffer and notify clients
     */
    clear() {
        this.messages = [];
        this._broadcastToClients("clear", { timestamp: Date.now() });
        return { success: true };
    }

    /**
     * Express SSE route subscriber
     */
    handleSSE(req, res) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("X-Accel-Buffering", "no"); // Disable proxy buffering (Nginx, Cloudflare)

        res.flushHeaders?.();

        // Send initial state with recent message history
        const initialPayload = {
            type: "init",
            messages: this.getRecent(30),
            serverTime: Date.now()
        };
        res.write(`event: init\ndata: ${JSON.stringify(initialPayload)}\n\n`);

        this.clients.add(res);

        req.on("close", () => {
            this.clients.delete(res);
        });
    }
}

const liveChatService = new LiveChatService();
module.exports = liveChatService;

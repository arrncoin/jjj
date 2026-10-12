// src/api/controllers/liveChatController.js
// Handles live chat stream, recent message queries, and simulation testing
const liveChatService = require("../../features/livechat/liveChatService");
const { errMsg } = require("../../core/utils/helpers");

module.exports = {
    /**
     * SSE stream for real-time live chat overlay
     */
    stream(req, res) {
        liveChatService.handleSSE(req, res);
    },

    /**
     * Get recent messages
     */
    getRecent(req, res) {
        const limit = parseInt(req.query.limit || "40", 10);
        const messages = liveChatService.getRecent(limit);
        res.set({
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Access-Control-Allow-Origin": "*"
        });
        res.json({
            success: true,
            count: messages.length,
            messages
        });
    },

    /**
     * Clear all current overlay messages
     */
    clear(req, res) {
        liveChatService.clear();
        res.json({ success: true, message: "Pesan overlay chat berhasil dibersihkan." });
    },

    /**
     * Simulate incoming chat, superchat, or gift for testing in OBS
     */
    simulate(req, res) {
        try {
            const {
                platform = "youtube",
                type = "chat",
                authorName = "Streamer",
                message = "Halo semuanya! Selamat datang di live stream!",
                amount,
                giftName,
                repeatCount = 1,
                isOwner = false,
                isMod = false,
                isMember = false,
                level
            } = req.body || {};

            let result = null;

            if (type === "gift") {
                result = liveChatService.onGift({
                    platform,
                    author: { displayName: authorName, uniqueId: authorName.toLowerCase().replace(/\s+/g, "_"), level },
                    giftName: giftName || "Mawar",
                    amount: `${giftName || "Mawar"} x${repeatCount}`,
                    repeatCount
                });
            } else if (type === "follow") {
                result = liveChatService.onFollow({
                    platform,
                    author: { displayName: authorName, uniqueId: authorName.toLowerCase().replace(/\s+/g, "_") }
                });
            } else if (type === "bot") {
                result = liveChatService.onBotResponse(message, authorName);
            } else {
                result = liveChatService.addMessage({
                    platform,
                    type: amount ? "superchat" : "chat",
                    cleanMessage: message,
                    amount: amount || null,
                    author: {
                        name: authorName,
                        isOwner,
                        isAdmin: isMod,
                        isModerator: isMod,
                        isMember,
                        level
                    }
                });
            }

            res.json({
                success: true,
                message: "Pesan simulasi berhasil dikirim ke live chat overlay!",
                item: result
            });
        } catch (err) {
            res.status(500).json({ success: false, reason: errMsg(err) });
        }
    }
};

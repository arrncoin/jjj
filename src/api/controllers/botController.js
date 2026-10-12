// src/api/controllers/botController.js
// Handles /api/bot/* endpoints and /api/health
const botManager = require("../../app/botManager");
const logger = require("../../core/logger/logger");
const licenseManager = require("../../core/licensing/licenseManager");
const youtubeService = require("../../integrations/youtube/youtubeService");
const tiktokService = require("../../integrations/tiktok/tiktokService");
const audioEngine = require("../../features/audio");
const { errMsg } = require("../../core/utils/helpers");

module.exports = {
    getStatus(req, res) {
        res.json(botManager.getStatus());
    },

    getHealth(req, res) {
        const license = licenseManager ? licenseManager.getStatus() : { valid: false, isUnlocked: false };
        res.json({
            status: "ok",
            botRunning: botManager.isRunning(),
            license: {
                valid: license.valid,
                tier: license.tier,
                remainingDays: license.remainingDays,
                expiresAt: license.expiresAt,
                isUnlocked: license.isUnlocked
            },
            platforms: [
                { name: "youtube", connected: youtubeService.isConnected },
                { name: "tiktok", connected: tiktokService.isConnected }
            ]
        });
    },

    getLogs(req, res) {
        res.json({ logs: logger.getLogs() });
    },

    clearLogs(req, res) {
        const category = req.body && req.body.category;
        const remainingLogs = logger.clearLogs(category);
        res.json({ success: true, logs: remainingLogs });
    },

    startBot(req, res) {
        const result = botManager.start();
        if (!result.success && result.reason) {
            return res.status(403).json(result);
        }
        res.json(result);
    },

    stopBot(req, res) {
        const result = botManager.stop();
        res.json(result);
    },

    async getTTSAudio(req, res) {
        try {
            const googleTTS = require("google-tts-api");
            const axios = require("axios");
            const text = (req.query.text || "Halo! Ini adalah tes suara Kak Jule.").slice(0, 200);
            const isSlow = process.env.VOICE_SPEED === "slow";
            const url = googleTTS.getAudioUrl(text, {
                lang: "id",
                slow: isSlow,
                host: "https://translate.google.com"
            });
            const response = await axios.get(url, {
                responseType: "arraybuffer",
                timeout: 8000
            });
            res.set({
                "Content-Type": "audio/mpeg",
                "Cache-Control": "public, max-age=86400",
                "Content-Length": response.data.length
            });
            res.send(Buffer.from(response.data));
        } catch (err) {
            res.status(500).json({ error: errMsg(err) });
        }
    },

    testTTS(req, res) {
        try {
            const sampleText = req.body?.text || "Halo streamer! Sistem suara Kak Jule aktif dan siap merespons obrolan live.";
            audioEngine.speak(sampleText, true);
            logger.bot(`[TEST SUARA] ${sampleText}`);
            const audioUrl = `/api/bot/tts-audio?text=${encodeURIComponent(sampleText)}`;
            res.json({ success: true, message: "Suara tes sedang diputar.", audioUrl });
        } catch (err) {
            res.status(500).json({ success: false, reason: errMsg(err) });
        }
    },

    simulateChat(req, res) {
        const { authorName, message } = req.body || {};
        const result = botManager.simulateChat(authorName, message);
        if (!result.success) {
            return res.status(400).json(result);
        }
        res.json(result);
    }
};

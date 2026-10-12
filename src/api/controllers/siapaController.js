// src/api/controllers/siapaController.js
// Handles /api/siapa/* endpoints
const siapaGame = require("../../features/game/siapa/game");
const siapaStorage = require("../../features/game/siapa/storage");

module.exports = {
    getState(req, res) {
        try {
            res.set({
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
                "Access-Control-Allow-Origin": "*"
            });
            const state = typeof siapaGame.getPublicState === "function" 
                ? siapaGame.getPublicState() 
                : { status: "idle", players: 0, alive: 0 };
            return res.json(state);
        } catch (err) {
            return res.status(500).json({ success: false, message: "Gagal mengambil state game." });
        }
    },

    getLeaderboard(req, res) {
        try {
            const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
            const sort = req.query.sort || "total_points";
            const leaderboard = typeof siapaStorage.getLeaderboard === "function" 
                ? siapaStorage.getLeaderboard(limit, sort) 
                : [];

            return res.json({
                success: true,
                leaderboard
            });
        } catch (err) {
            return res.status(500).json({ success: false, message: "Gagal mengambil data leaderboard." });
        }
    },

    getStats(req, res) {
        try {
            const username = req.params.username ? req.params.username.trim() : "";
            if (!username) {
                return res.status(400).json({ success: false, message: "Username wajib diisi" });
            }

            const stats = typeof siapaStorage.getPlayerStats === "function" 
                ? siapaStorage.getPlayerStats(username) 
                : null;

            return res.json({
                success: true,
                stats
            });
        } catch (err) {
            return res.status(500).json({ success: false, message: "Gagal mengambil statistik pemain." });
        }
    },

    handleAction(req, res) {
        try {
            const { action, seconds, username, choice } = req.body || {};

            if (!action) {
                return res.status(400).json({ success: false, message: "Aksi tidak boleh kosong" });
            }

            if (action === "start") {
                const duration = Math.max(5, Number(seconds) || 20);
                const result = siapaGame.startLobby(username || "Dashboard", duration);
                return res.json(result);
            }

            if (action === "stop") {
                const result = siapaGame.stop(username || "Dashboard");
                return res.json(result);
            }

            if (action === "reset") {
                const result = siapaGame.reset();
                return res.json(result);
            }

            if (action === "join") {
                if (!username) {
                    return res.status(400).json({ success: false, message: "Username wajib diisi untuk join" });
                }
                const result = siapaGame.join(username);
                return res.json(result);
            }

            if (action === "input") {
                if (!username || choice === undefined) {
                    return res.status(400).json({ success: false, message: "Username dan choice wajib diisi" });
                }
                const ok = siapaGame.handlePlayerInput(username, choice);
                return res.json({ success: ok });
            }

            return res.status(400).json({ success: false, message: "Aksi tidak dikenal" });
        } catch (err) {
            return res.status(500).json({ success: false, message: "Terjadi kesalahan server saat memproses aksi." });
        }
    }
};
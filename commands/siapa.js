// commands/siapa.js
// Command Handler for SIAPA Interactive Survival Livechat Game
const siapaGame = require("../games/siapa/game");
const storage = require("../games/siapa/storage");
const logger = require("../core/utils/logger");

module.exports = async function handleSiapa(cmd, args, speak, stopAndClear, isAllowed, sender, ctx = {}) {
    if (!cmd || typeof cmd !== "string") return false;

    const trimmed = cmd.trim();
    const cleanLower = trimmed.toLowerCase();
    const parts = cleanLower.split(/\s+/);
    const verb = parts[0];

    // Hubungkan audio speak jika belum
    if (typeof siapaGame.setSpeakHandler === "function") {
        siapaGame.setSpeakHandler(speak);
    }

    // =========================================================================
    // 1. COMMAND UTAMA: !siapa (Lobby, Stop, Status, Reset, Top)
    // =========================================================================
    if (verb === "!siapa") {
        const sub = parts[1];

        // 1.1 Leaderboard: !siapa top / !siapa leaderboard / !siapa rank
        if (sub === "top" || sub === "leaderboard" || sub === "rank") {
            const topList = storage.getLeaderboard(5);
            if (!topList || topList.length === 0) {
                speak("Belum ada data klasemen untuk game Siapa. Yuk mainkan sekarang dengan ketik tanda seru siapa!", true);
                return true;
            }

            let text = "🏆 SIAPA LEADERBOARD:\n";
            topList.forEach((p, idx) => {
                const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}.`;
                text += `${medal} ${p.username || "Pemain"} - ${p.totalPoints || 0} pts (${p.wins || 0} Wins)\n`;
            });
            logger.info(text);

            const topOne = topList[0];
            speak(`Klasemen teratas game Siapa: Peringkat satu dipegang oleh ${topOne.username || "Pemain"} dengan total ${topOne.totalPoints || 0} poin!`, true);
            return true;
        }

        // 1.2 Status: !siapa status
        if (sub === "status") {
            const state = siapaGame.getPublicState ? siapaGame.getPublicState() : {};
            if (!siapaGame.isActive()) {
                speak("Game Siapa saat ini tidak aktif. Ketik tanda seru siapa untuk membuka arena baru.", true);
                return true;
            }

            const elapsedSec = Math.floor((Date.now() - (siapaGame.gameStartedAt || Date.now())) / 1000);
            const m = Math.floor(elapsedSec / 60);
            const s = elapsedSec % 60;
            const timeStr = `${m}:${s < 10 ? "0" : ""}${s}`;

            const statusMsg = `SIAPA STATUS:
Status : ${(state.status || "IDLE").toUpperCase()}
Ronde  : ${state.round || 0}/${state.totalRounds || 0}
Total  : ${state.players || 0} Pemain
Alive  : ${state.alive || 0} Bertahan
Durasi : ${timeStr}`;

            logger.info(statusMsg);
            speak(`Status game Siapa: Ronde ${state.round || 0} dari ${state.totalRounds || 0}, tersisa ${state.alive || 0} pemain bertahan.`);
            return true;
        }

        // 1.3 Stop: !siapa stop (Admin / Owner Only)
        if (sub === "stop" || sub === "selesai" || sub === "batal") {
            if (!isAllowed) {
                speak("Perintah menghentikan game Siapa hanya bisa dijalankan oleh streamer atau admin.", true);
                return true;
            }
            const res = siapaGame.stop(sender);
            if (res && res.message) speak(res.message, true);
            return true;
        }

        // 1.4 Reset: !siapa reset (Admin / Owner Only)
        if (sub === "reset") {
            if (!isAllowed) {
                speak("Perintah reset game Siapa hanya bisa dijalankan oleh streamer atau admin.", true);
                return true;
            }
            const res = siapaGame.reset();
            if (res && res.message) speak(res.message, true);
            return true;
        }

        // 1.5 Start Lobby: !siapa [custom_seconds] (Admin / Owner / Streamer)
        if (!isAllowed) {
            speak("Arena Siapa Yang Akan Bertahan hanya bisa dimulai oleh streamer atau moderator.", true);
            return true;
        }

        if (siapaGame.isActive()) {
            speak("⚠️ Game SIAPA sedang berlangsung! Tunggu sampai game selesai.", true);
            return true;
        }

        // Validasi: Pastikan jika ada sub-command, nilainya adalah angka durasi detik
        let customSeconds = 20;
        if (sub !== undefined) {
            const parsed = Number(sub);
            if (isNaN(parsed) || parsed <= 0) {
                speak("Format perintah tidak dikenal. Gunakan !siapa untuk mulai, atau !siapa top / status / stop.", true);
                return true;
            }
            customSeconds = parsed;
        }

        const result = siapaGame.startLobby(sender, customSeconds);
        if (result && !result.success && result.message) {
            speak(result.message, true);
        }
        return true;
    }

    // =========================================================================
    // 2. COMMAND PENONTON: !join
    // =========================================================================
    if (verb === "!join" || verb === "!gabung" || verb === "!masuk") {
        if (!siapaGame.isActive()) {
            return false; // Izinkan command lain memproses !join jika bukan untuk SIAPA
        }

        if (!siapaGame.isLobby()) {
            logger.warn(`[SIAPA] @${sender} mencoba !join namun pendaftaran sudah ditutup.`);
            return true;
        }

        const joinResult = siapaGame.join(sender);
        if (joinResult && joinResult.success) {
            logger.info(`✅ [SIAPA] @${sender} bergabung! Total: ${joinResult.totalPlayers}`);
        }
        return true;
    }

    // =========================================================================
    // 3. COMMAND TANTANGAN / CHALLENGE RONDE (!kiri, !kanan, !pilih)
    // =========================================================================
    if (siapaGame.isActive() && siapaGame.status === "running") {
        if (verb === "!kiri" || verb === "!kanan") {
            const side = verb.replace("!", "");
            siapaGame.handlePlayerInput(sender, side);
            return true;
        }

        if (verb === "!pilih") {
            const chosen = parts.slice(1).join(" ").trim();
            if (chosen) {
                siapaGame.handlePlayerInput(sender, chosen);
                return true;
            }
        }
    }

    return false;
};
// games/siapa/game.js
// Master Game Engine for SIAPA Interactive Survival Livechat Game
const EventEmitter = require("events");
const Player = require("./player");
const storage = require("./storage");
const { REWARDS, getRoundSurvivalPoints } = require("./scoring");
const { calculateRoundSchedule, resolveRound, fairShuffle } = require("./rounds");
const EVENTS = require("./events");
const logger = require("../../core/utils/logger");
const overlayState = require("../../core/utils/overlayState");
const pointManager = require("../../core/points/pointManager");

class SiapaGameEngine extends EventEmitter {
    constructor() {
        super();
        this.status = "idle"; // "idle" | "lobby" | "preparing" | "running" | "eliminating" | "cooldown" | "winner"
        this.players = new Map(); // username.toLowerCase() -> Player
        this.alivePlayers = []; // Array of active Player
        this.eliminatedPlayers = []; // Array of eliminated Player
        
        this.roundSchedule = [];
        this.currentRoundIndex = 0;
        this.currentRoundConfig = null;

        this.lobbyCountdown = 60; 
        this.initialLobbyCountdown = 60; // FIX: Menyimpan total durasi awal lobby
        this.roundCountdown = 0;
        this.roundTotalCountdown = 0;
        this.cooldownCountdown = 0;
        this.cooldownTotal = 30;
        this.preparingCountdown = 0;
        this.preparingTotal = 30;
        this.timer = null;
        this.roundStateTimer = null;

        this.lastEliminated = []; // Max 12 untuk visual
        this.recentJoined = []; // Max 15 untuk visual
        this.winner = null;
        this.runnerUp = null;
        this.finalPlayers = [];

        this.gameStartedAt = 0;
        this.initiator = "Streamer";
        this.speakHandler = null;
    }

    /**
     * Daftarkan handler TTS (Kak Jule)
     */
    setSpeakHandler(handler) {
        this.speakHandler = handler;
    }

    speak(text, priority = false) {
        if (typeof this.speakHandler === "function") {
            try {
                this.speakHandler(text, priority);
            } catch (_) {}
        }
    }

    isActive() {
        return this.status !== "idle";
    }

    isLobby() {
        return this.status === "lobby";
    }

    /**
     * Memulai game / lobby baru
     */
    startLobby(initiator = "Streamer", customLobbySeconds = 60) {
        if (this.isActive()) {
            return {
                success: false,
                message: "⚠️ Game SIAPA sedang berlangsung! Tunggu sampai game selesai."
            };
        }

        this.resetInternal();
        this.status = "lobby";
        this.initiator = initiator;
        this.gameStartedAt = Date.now();
        this.lobbyCountdown = Math.max(10, Math.min(60, Number(customLobbySeconds) || 60));
        this.initialLobbyCountdown = this.lobbyCountdown; // FIX: Sync total countdown

        logger.info(`⚡ [SIAPA] GAME STARTED — Lobby dibuka oleh ${initiator}. Pendaftaran ${this.lobbyCountdown} detik.`);
        this.speak(`Game survival Siapa Yang Akan Bertahan telah dibuka! Ketik tanda seru join di chat sekarang untuk masuk arena!`, true);

        this.emit(EVENTS.GAME_STARTED, { initiator, countdown: this.lobbyCountdown });
        this.emit(EVENTS.LOBBY_START, { countdown: this.lobbyCountdown });
        this.syncOverlay();

        this.clearTimers();
        this.timer = setInterval(() => {
            this.lobbyCountdown--;
            this.emit(EVENTS.LOBBY_COUNTDOWN, { countdown: this.lobbyCountdown, playersCount: this.players.size });
            this.syncOverlay();

            if (this.lobbyCountdown <= 0) {
                this.closeLobbyAndStart();
            }
        }, 1000);

        return {
            success: true,
            message: `⚡ Arena SIAPA dibuka! Ketik !join untuk mendaftar (waktu: ${this.lobbyCountdown}s)`
        };
    }

    /**
     * Menambahkan pemain ke dalam arena
     */
    join(rawUsername, meta = {}) {
        if (this.status !== "lobby") {
            return { success: false, reason: "lobby_closed", message: "Pendaftaran SIAPA sudah ditutup atau game sedang berjalan." };
        }

        if (!rawUsername) return { success: false, reason: "invalid_username" };
        const cleanName = String(rawUsername).replace(/^@/, "").trim();
        const lowerName = cleanName.toLowerCase();

        if (this.players.has(lowerName)) {
            return { success: false, reason: "already_joined", message: "Kamu sudah terdaftar di arena ini!" };
        }

        if (this.players.size >= 1000) {
            return { success: false, reason: "arena_full", message: "Kapasitas arena penuh (maksimal 1000 pemain)!" };
        }

        const player = new Player(cleanName);
        player.addPoints(REWARDS.JOIN); // +10 poin registrasi
        this.players.set(lowerName, player);

        // Queue visual recent joined (Max 15)
        this.recentJoined.push(cleanName);
        if (this.recentJoined.length > 15) {
            this.recentJoined.shift();
        }

        logger.info(`[SIAPA] PLAYER JOINED: @${cleanName} (Total: ${this.players.size}/1000)`);
        this.emit(EVENTS.PLAYER_JOINED, {
            username: cleanName,
            totalPlayers: this.players.size,
            player: player.toJSON()
        });
        this.syncOverlay();

        return {
            success: true,
            username: cleanName,
            totalPlayers: this.players.size,
            points: player.points
        };
    }

    handlePlayerInput(rawUsername, action) {
        if (this.status !== "running" || !this.currentRoundConfig) return false;
        if (!rawUsername || !action) return false;

        const lowerName = String(rawUsername).replace(/^@/, "").trim().toLowerCase();
        const player = this.players.get(lowerName);

        if (!player || !player.alive) return false;

        const cleanAction = String(action).toLowerCase().trim();
        player.setAction(cleanAction);
        return true;
    }

    closeLobbyAndStart() {
        this.clearTimers();
        this.emit(EVENTS.LOBBY_CLOSED, { totalPlayers: this.players.size });

        const totalJoined = this.players.size;
        if (totalJoined < 2) {
            logger.warn(`⚠️ [SIAPA] Pemain kurang dari 2 (terdaftar: ${totalJoined}). Game dibatalkan.`);
            this.speak("Pemain yang bergabung kurang dari dua orang. Arena Siapa Yang Akan Bertahan dibatalkan. Yuk coba lagi nanti!", true);
            this.reset();
            return;
        }

        this.alivePlayers = Array.from(this.players.values());
        this.roundSchedule = calculateRoundSchedule(totalJoined);
        this.currentRoundIndex = 0;

        logger.info(`[SIAPA] LOBBY CLOSED — Total: ${totalJoined} pemain. Jadwal ronde: ${this.roundSchedule.length} ronde.`);
        this.speak(`Pendaftaran ditutup! Sebanyak ${totalJoined} pemain telah memasuki arena! Ronde satu dimulai sekarang!`, true);
        this.syncOverlay();

        setTimeout(() => {
            this.startPreparing();
        }, 2000);
    }

    /**
     * Fase persiapan sebelum ronde dimulai.
     * Kak Jule mengumumkan keterangan ronde, lalu countdown 30 detik.
     */
    startPreparing() {
        this.clearTimers();

        if (!this.isActive() || this.alivePlayers.length <= 1) {
            this.finalizeWinner();
            return;
        }

        if (this.currentRoundIndex >= this.roundSchedule.length) {
            this.currentRoundConfig = {
                roundNumber: this.currentRoundIndex + 1,
                targetSurvivors: 1,
                challenge: {
                    id: "FINAL_DUEL",
                    title: "⚔️ FINAL DUEL ⚔️",
                    badge: "PENENTUAN JUARA",
                    desc: "Duel terakhir penentuan juara!",
                    duration: 10
                }
            };
        } else {
            this.currentRoundConfig = this.roundSchedule[this.currentRoundIndex];
        }

        this.status = "preparing";
        const roundNum = this.currentRoundConfig.roundNumber;
        const totalRounds = this.roundSchedule.length;
        const challenge = this.currentRoundConfig.challenge;
        const aliveCount = this.alivePlayers.length;

        this.preparingTotal = 30;
        this.preparingCountdown = this.preparingTotal;

        logger.info(`[SIAPA] PREPARING — Ronde ${roundNum}/${totalRounds}: ${challenge.title} | ${aliveCount} pemain bersiap`);

        if (aliveCount === 2) {
            this.speak(`Perhatian! Final duel akan segera dimainkan antara ${this.alivePlayers[0].username} melawan ${this.alivePlayers[1].username}! Bersiaplah!`, true);
        } else if (roundNum === 1) {
            this.speak(`Ronde satu akan segera dimulai! ${challenge.title}. ${challenge.desc}. Bersiaplah selama tiga puluh detik!`, true);
        } else {
            this.speak(`Ronde ${roundNum} akan segera dimulai! ${challenge.title}. ${challenge.desc}. Bersiaplah selama tiga puluh detik!`, true);
        }

        this.emit(EVENTS.PREPARING_STARTED, {
            round: roundNum,
            totalRounds,
            alive: aliveCount,
            challenge,
            countdown: this.preparingCountdown,
            totalCountdown: this.preparingTotal
        });
        this.syncOverlay();

        this.timer = setInterval(() => {
            this.preparingCountdown--;
            this.emit(EVENTS.PREPARING_TICK, { countdown: this.preparingCountdown });
            this.syncOverlay();

            if (this.preparingCountdown <= 0) {
                this.clearTimers();
                this.startNextRound();
            }
        }, 1000);
    }

    startNextRound() {
        if (!this.isActive() || this.alivePlayers.length <= 1) {
            this.finalizeWinner();
            return;
        }

        if (this.currentRoundIndex >= this.roundSchedule.length) {
            this.currentRoundConfig = {
                roundNumber: this.currentRoundIndex + 1,
                targetSurvivors: 1,
                challenge: {
                    id: "FINAL_DUEL",
                    title: "⚔️ FINAL DUEL ⚔️",
                    badge: "PENENTUAN JUARA",
                    desc: "Duel terakhir penentuan juara!",
                    duration: 10
                }
            };
        } else {
            this.currentRoundConfig = this.roundSchedule[this.currentRoundIndex];
        }

        this.status = "running";
        const roundNum = this.currentRoundConfig.roundNumber;
        const totalRounds = this.roundSchedule.length;
        const challenge = this.currentRoundConfig.challenge;
        const aliveCount = this.alivePlayers.length;

        for (const p of this.alivePlayers) {
            p.resetAction();
        }

        if (aliveCount <= 2) {
            this.finalPlayers = this.alivePlayers.map(p => p.toJSON());
            this.emit(EVENTS.FINAL_DUEL, { finalPlayers: this.finalPlayers });
        } else if (aliveCount <= 10) {
            this.emit(EVENTS.FINAL_STARTED, { aliveCount });
        }

        this.roundCountdown = challenge.duration || 10;
        this.roundTotalCountdown = this.roundCountdown;
        logger.info(`[SIAPA] ROUND STARTED — Ronde ${roundNum}/${totalRounds}: ${challenge.title} | ${aliveCount} pemain bertahan`);

        if (aliveCount === 2) {
            this.speak(`Final duel dua pemain terhebat! ${this.alivePlayers[0].username} melawan ${this.alivePlayers[1].username}! Siapa yang akan bertahan?`, true);
        } else if (roundNum === 1) {
            this.speak(`Ronde satu! Tantangan: ${challenge.title}. ${challenge.desc}`);
        } else {
            this.speak(`Ronde ${roundNum}! ${challenge.title}! ${challenge.desc}`);
        }

        this.emit(EVENTS.ROUND_STARTED, {
            round: roundNum,
            totalRounds,
            alive: aliveCount,
            totalPlayers: this.players.size,
            challenge,
            countdown: this.roundCountdown
        });
        this.syncOverlay();

        this.clearTimers();
        this.timer = setInterval(() => {
            this.roundCountdown--;
            this.emit(EVENTS.CHALLENGE_TICK, { countdown: this.roundCountdown });
            this.syncOverlay();

            if (this.roundCountdown <= 0) {
                this.executeElimination();
            }
        }, 1000);
    }

    executeElimination() {
        this.clearTimers();
        this.status = "eliminating";

        const { survivors, eliminated, meta } = resolveRound(
            this.currentRoundConfig,
            this.alivePlayers,
            this.players.size
        );

        this.alivePlayers = survivors;
        for (const e of eliminated) {
            this.eliminatedPlayers.push(e);
        }

        this.lastEliminated = eliminated.slice(0, 12).map(e => ({
            username: e.username,
            rank: e.rank,
            round: e.round
        }));

        const roundPoints = getRoundSurvivalPoints(this.currentRoundConfig.roundNumber);
        for (const s of survivors) {
            s.addPoints(roundPoints);
        }

        logger.info(`[SIAPA] ROUND COMPLETED — Ronde ${this.currentRoundConfig.roundNumber}. Gugur: ${eliminated.length} | Selamat: ${survivors.length}. ${meta.detail}`);

        this.emit(EVENTS.ROUND_COMPLETED, {
            round: this.currentRoundConfig.roundNumber,
            totalRounds: this.roundSchedule.length,
            alive: survivors.length,
            eliminatedCount: eliminated.length,
            lastEliminated: this.lastEliminated,
            meta,
            survivorReward: roundPoints
        });
        this.syncOverlay();

        if (survivors.length > 1) {
            this.speak(`${eliminated.length} pemain tereliminasi! Tersisa ${survivors.length} pemain yang masih bertahan!`);
        }

        this.currentRoundIndex++;

        // Jeda cooldown antar ronde sebelum lanjut ke ronde berikutnya
        this.roundStateTimer = setTimeout(() => {
            if (this.alivePlayers.length <= 1) {
                this.finalizeWinner();
            } else {
                this.startCooldown();
            }
        }, 3500);
    }

    /**
     * Fase cooldown antar ronde (default 30 detik).
     * Menampilkan hitung mundur di overlay sebelum tantangan ronde berikutnya dibuka.
     */
    startCooldown() {
        this.clearTimers();

        if (!this.isActive() || this.alivePlayers.length <= 1) {
            this.finalizeWinner();
            return;
        }

        const nextRoundNumber = this.currentRoundIndex + 1;
        this.status = "cooldown";
        this.cooldownTotal = 30;
        this.cooldownCountdown = this.cooldownTotal;

        logger.info(`[SIAPA] COOLDOWN — Ronde ${nextRoundNumber} akan dimulai dalam ${this.cooldownTotal} detik.`);
        this.speak(`Ronde berikutnya dimulai dalam tiga puluh detik. Bersiap di chat!`);
        this.emit(EVENTS.ROUND_COOLDOWN, {
            nextRound: nextRoundNumber,
            countdown: this.cooldownCountdown,
            totalCountdown: this.cooldownTotal
        });
        this.syncOverlay();

        this.timer = setInterval(() => {
            this.cooldownCountdown--;
            this.emit(EVENTS.ROUND_COOLDOWN_TICK, { countdown: this.cooldownCountdown, nextRound: nextRoundNumber });
            this.syncOverlay();

            if (this.cooldownCountdown <= 0) {
                this.clearTimers();
                this.startPreparing();
            }
        }, 1000);
    }

    finalizeWinner() {
        this.clearTimers();
        this.status = "winner";

        const winnerPlayer = this.alivePlayers[0] || this.eliminatedPlayers[this.eliminatedPlayers.length - 1];
        const runnerUpPlayer = this.eliminatedPlayers.find(p => p.rank === 2) || (this.alivePlayers.length > 1 ? this.alivePlayers[1] : null);

        if (winnerPlayer) {
            winnerPlayer.rank = 1;
            winnerPlayer.addPoints(REWARDS.WINNER);
        }

        if (runnerUpPlayer) {
            runnerUpPlayer.addPoints(REWARDS.RUNNER_UP);
        }

        const top3Player = this.eliminatedPlayers.find(p => p.rank === 3);
        if (top3Player) {
            top3Player.addPoints(REWARDS.TOP_3);
        }

        this.winner = winnerPlayer ? winnerPlayer.toJSON() : null;
        this.runnerUp = runnerUpPlayer ? runnerUpPlayer.toJSON() : null;

        try {
            storage.recordGameResult({
                players: Array.from(this.players.values()).map(p => p.toJSON()),
                totalRounds: this.roundSchedule.length,
                winner: this.winner,
                runnerUp: this.runnerUp
            });

            for (const p of this.players.values()) {
                if (p.points > 0) {
                    try {
                        const desc = p.rank === 1
                            ? `Juara 1 SIAPA (+${p.points} poin)`
                            : (p.rank === 2
                                ? `Runner Up SIAPA (+${p.points} poin)`
                                : (p.rank === 3
                                    ? `Top 3 SIAPA (+${p.points} poin)`
                                    : `Partisipasi SIAPA (${p.round || 1} ronde, +${p.points} poin)`));
                        pointManager.addPoints(p.username, p.points, "siapa", desc);
                    } catch (_) {}
                }
            }

            logger.info(`[SIAPA] POINTS AWARDED & SAVED TO PERSISTENT DATABASE`);
        } catch (err) {
            console.error("❌ [SIAPA ERROR] Gagal simpan hasil game ke database:", err.message);
        }

        const winnerStats = winnerPlayer ? storage.getPlayerStats(winnerPlayer.username) : null;
        const winnerName = winnerPlayer ? winnerPlayer.username : "Tidak Ada";

        logger.info(`[SIAPA] WINNER — 🏆 @${winnerName} berhasil bertahan dan menjadi Juara SIAPA!`);
        this.speak(`Luar biasa! Selamat kepada ${winnerName} yang berhasil menjadi satu-satunya yang bertahan di arena Siapa! Kamu memenangkan seribu poin!`, true);

        this.emit(EVENTS.WINNER, {
            winner: this.winner,
            runnerUp: this.runnerUp,
            stats: winnerStats
        });
        this.syncOverlay();

        this.roundStateTimer = setTimeout(() => {
            this.endGame();
        }, 10000);
    }

    endGame() {
        this.clearTimers();
        logger.info(`[SIAPA] GAME ENDED — Arena kembali ke mode standby.`);
        this.emit(EVENTS.GAME_ENDED, { winner: this.winner });
        this.status = "idle";
        this.syncOverlay();
    }

    stop(stoppedBy = "Streamer") {
        if (!this.isActive()) {
            return { success: false, message: "ℹ️ Tidak ada game SIAPA yang sedang berjalan." };
        }

        this.clearTimers();
        logger.warn(`[SIAPA] GAME STOPPED — Dihentikan oleh ${stoppedBy}.`);
        this.speak("Permainan Siapa Yang Akan Bertahan telah dihentikan.", true);

        try {
            storage.recordGameResult({
                players: Array.from(this.players.values()).map(p => p.toJSON()),
                totalRounds: this.currentRoundIndex + 1,
                winner: null,
                runnerUp: null
            });

            for (const p of this.players.values()) {
                if (p.points > 0) {
                    try {
                        pointManager.addPoints(p.username, p.points, "siapa", `Partisipasi SIAPA (+${p.points} poin)`);
                    } catch (_) {}
                }
            }
        } catch (_) {}

        this.emit(EVENTS.GAME_STOPPED, { stoppedBy });
        this.resetInternal();
        this.status = "idle";
        this.syncOverlay();

        return { success: true, message: "⏹️ Game SIAPA berhasil dihentikan." };
    }

    reset() {
        this.clearTimers();
        this.resetInternal();
        this.status = "idle";
        this.emit(EVENTS.GAME_ENDED, { reset: true });
        this.syncOverlay();
        return { success: true, message: "🔄 Game SIAPA berhasil di-reset ke status standby." };
    }

    resetInternal() {
        this.players.clear();
        this.alivePlayers = [];
        this.eliminatedPlayers = [];
        this.roundSchedule = [];
        this.currentRoundIndex = 0;
        this.currentRoundConfig = null;
        this.lobbyCountdown = 60;
        this.initialLobbyCountdown = 60;
        this.roundCountdown = 0;
        this.roundTotalCountdown = 0;
        this.cooldownCountdown = 0;
        this.cooldownTotal = 30;
        this.preparingCountdown = 0;
        this.preparingTotal = 30;
        this.lastEliminated = [];
        this.recentJoined = [];
        this.winner = null;
        this.runnerUp = null;
        this.finalPlayers = [];
        this.gameStartedAt = 0;
    }

    clearTimers() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.roundStateTimer) {
            clearTimeout(this.roundStateTimer);
            this.roundStateTimer = null;
        }
    }

    getPublicState() {
        const totalPlayers = this.players.size;
        const aliveCount = this.alivePlayers.length;
        const eliminatedCount = this.eliminatedPlayers.length;
        const totalRounds = this.roundSchedule.length || 1;
        const currentRound = this.currentRoundConfig ? this.currentRoundConfig.roundNumber : 0;

        let winnerStats = null;
        if (this.winner) {
            winnerStats = storage.getPlayerStats(this.winner.username);
        }

        return {
            game: "siapa",
            status: this.status, 
            round: currentRound,
            totalRounds,
            players: totalPlayers,
            alive: aliveCount,
            eliminated: eliminatedCount,
            countdown: this.status === "lobby"
                ? this.lobbyCountdown
                : (this.status === "preparing" ? this.preparingCountdown
                    : (this.status === "cooldown" ? this.cooldownCountdown : this.roundCountdown)),
            totalCountdown: this.status === "lobby"
                ? (this.initialLobbyCountdown || 60)
                : (this.status === "preparing"
                    ? (this.preparingTotal || 30)
                    : (this.status === "cooldown"
                        ? (this.cooldownTotal || 30)
                        : (this.roundTotalCountdown || this.currentRoundConfig?.challenge?.duration || 10))),
            nextRound: (this.status === "cooldown" || this.status === "preparing") ? (this.currentRoundIndex + 1) : null,
            currentChallenge: this.currentRoundConfig ? this.currentRoundConfig.challenge : null,
            lastEliminated: this.lastEliminated,
            recentJoined: this.recentJoined,
            finalPlayers: this.finalPlayers,
            winner: this.winner ? {
                ...this.winner,
                stats: winnerStats
            } : null,
            runnerUp: this.runnerUp,
            leaderboard: storage.getLeaderboard(5),
            updatedAt: Date.now()
        };
    }

    syncOverlay() {
        try {
            if (this.isActive()) {
                overlayState.set({
                    mode: "siapa",
                    ...this.getPublicState()
                });
            } else {
                overlayState.set({
                    mode: "dashboard"
                });
            }
        } catch (_) {}
    }
}

module.exports = new SiapaGameEngine();
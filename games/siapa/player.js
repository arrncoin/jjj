// games/siapa/player.js
// Lightweight, High-Performance Player Model for SIAPA Survival Game

let globalPlayerSequence = 0; // Incremental sequence untuk menjamin keunikan ID

class Player {
    /**
     * @param {string} username
     * @param {string|null} [id=null]
     */
    constructor(username, id = null) {
        this.username = String(username || "").trim();
        
        // FIX: Generator ID yang tahan terhadap burst join berkecepatan tinggi
        globalPlayerSequence = (globalPlayerSequence + 1) % 9999;
        const randStr = Math.random().toString(36).substring(2, 8);
        this.id = id || `p_${Date.now().toString(36)}_${globalPlayerSequence}_${randStr}`;

        this.points = 0;
        this.alive = true;
        this.eliminated = false;
        this.rank = 0;
        this.round = 0;
        this.joinTime = Date.now();
        
        // Data aksi per ronde (misal: "kiri", "kanan", "3")
        this.currentAction = null;
        this.actionTime = 0;
    }

    /**
     * Set aksi pemain pada tantangan ronde
     * @param {string} action
     */
    setAction(action) {
        if (action === null || action === undefined) {
            this.currentAction = null;
            this.actionTime = 0;
            return;
        }
        
        // FIX: Sanitasi tipe data ke string aman
        this.currentAction = String(action).trim().toLowerCase();
        this.actionTime = Date.now();
    }

    /**
     * Reset aksi pemain saat ronde baru dimulai
     */
    resetAction() {
        this.currentAction = null;
        this.actionTime = 0;
    }

    /**
     * Tandai pemain gugur
     * @param {number} rank
     * @param {number} round
     */
    eliminate(rank, round) {
        this.alive = false;
        this.eliminated = true;
        this.rank = Math.max(1, Number(rank) || 0);
        this.round = Math.max(1, Number(round) || 0);
    }

    /**
     * Tambah poin sementara dalam game
     * @param {number} pts
     */
    addPoints(pts) {
        const parsedPts = Number(pts);
        if (!isNaN(parsedPts)) {
            this.points += parsedPts;
        }
    }

    /**
     * Representasi ringkas untuk serialisasi JSON / State broadcast
     */
    toJSON() {
        return {
            username: this.username,
            id: this.id,
            points: this.points,
            alive: this.alive,
            eliminated: this.eliminated,
            rank: this.rank,
            round: this.round,
            joinTime: this.joinTime,
            currentAction: this.currentAction // Bermanfaat untuk overlay / debug jika dibutuhkan
        };
    }
}

module.exports = Player;
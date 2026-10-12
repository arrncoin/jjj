// src/features/game/siapa/config.js
// Konfigurasi terpusat untuk game SIAPA (lobby, cooldown, durasi).
// Ubah nilai di sini untuk menyesuaikan ritme arena tanpa menyentuh logic.

module.exports = {
    // ── Waktu pendaftaran (lobby) ──────────────────────────────
    DEFAULT_LOBBY_SECONDS: 60, // 1 menit (default waktu join)
    MIN_LOBBY_SECONDS: 10,
    MAX_LOBBY_SECONDS: 300,

    // ── Cooldown antar ronde ───────────────────────────────────
    ROUND_COOLDOWN_SECONDS: 30, // 30 detik jeda tiap ronde baru
    ROUND_DURATION: 30, // 30 detik durasi per ronde tantangan

    // ── Jeda transisi lainnya (ms) ─────────────────────────────
    PRE_FIRST_ROUND_DELAY_MS: 2000, // setelah pendaftaran ditutup → ronde 1
    WINNER_CELEBRATION_MS: 10000,   // durasi tampilan selebrasi juara
    ARENA_CAPACITY: 1000            // kapasitas maksimal pemain
};

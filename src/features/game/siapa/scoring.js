// games/siapa/scoring.js
// Configurable Point Rewards for SIAPA Survival Game

const REWARDS = {
    // Reward saat berhasil join lobby
    JOIN: 5,

    // Reward per ronde yang berhasil dilewati hidup-hidup (Ronde 1 s/d 10+)
    ROUND_SURVIVE_BASE: {
        1: 5,
        2: 10,
        3: 15,
        4: 20,
        5: 25,
        6: 30,
        7: 35,
        8: 40,
        9: 45,
        10: 50
    },

    // Default reward jika ronde melebihi tabel
    DEFAULT_ROUND_SURVIVE: 50,

    // Bonus penempatan akhir
    TOP_3: 25,
    RUNNER_UP: 50,
    WINNER: 100
};

/**
 * Menghitung poin reward bertahan di ronde tertentu
 * @param {number} roundNumber
 * @returns {number}
 */
function getRoundSurvivalPoints(roundNumber) {
    if (REWARDS.ROUND_SURVIVE_BASE[roundNumber]) {
        return REWARDS.ROUND_SURVIVE_BASE[roundNumber];
    }
    return REWARDS.DEFAULT_ROUND_SURVIVE;
}

module.exports = {
    REWARDS,
    getRoundSurvivalPoints
};

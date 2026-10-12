// overlay/siapa/app.js
// High-Performance OBS Overlay Client for SIAPA Interactive Survival Game

(function () {
    "use strict";

    // Helper untuk keamanan penulisan HTML
    function escapeHTML(str) {
        if (str === null || str === undefined) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // =========================================================
    // 1. CANVAS PARTICLE & CONFETTI ENGINE (High-Perf, Low CPU)
    // =========================================================
    const canvas = document.getElementById("fx-canvas");
    const ctx = canvas ? canvas.getContext("2d") : null;
    let particles = [];
    let confettis = [];
    let shockwaves = [];
    let confettiIntervalId = null;

    function resizeCanvas() {
        if (!canvas) return;
        canvas.width = 800;
        canvas.height = 1000;
    }
    resizeCanvas();

    class Particle {
        constructor() {
            this.reset();
        }
        reset() {
            this.x = Math.random() * 800;
            this.y = 1000 + Math.random() * 50;
            this.vx = (Math.random() - 0.5) * 1.5;
            this.vy = -(Math.random() * 2 + 1);
            this.size = Math.random() * 3 + 1;
            this.alpha = Math.random() * 0.7 + 0.3;
            this.color = Math.random() > 0.5 ? "rgba(6, 182, 212," : "rgba(236, 72, 153,";
        }
        update() {
            this.x += this.vx;
            this.y += this.vy;
            this.alpha -= 0.003;
            if (this.y < -10 || this.alpha <= 0) {
                this.reset();
            }
        }
        draw(ctx) {
            ctx.fillStyle = `${this.color}${this.alpha})`;
            ctx.shadowBlur = 8;
            ctx.shadowColor = this.color.includes("182") ? "#06b6d4" : "#ec4899";
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    class Confetti {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 12 + 4;
            this.vx = Math.cos(angle) * speed;
            this.vy = Math.sin(angle) * speed - 6;
            this.gravity = 0.35;
            this.size = Math.random() * 8 + 4;
            this.rotation = Math.random() * 360;
            this.rotSpeed = (Math.random() - 0.5) * 15;
            this.colors = ["#fbbf24", "#06b6d4", "#ec4899", "#10b981", "#ffffff", "#f472b6"];
            this.color = this.colors[Math.floor(Math.random() * this.colors.length)];
            this.alpha = 1;
        }
        update() {
            this.vy += this.gravity;
            this.x += this.vx;
            this.y += this.vy;
            this.rotation += this.rotSpeed;
            if (this.y > 600) {
                this.alpha -= 0.015;
            }
        }
        draw(ctx) {
            if (this.alpha <= 0) return;
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate((this.rotation * Math.PI) / 180);
            ctx.globalAlpha = Math.max(0, this.alpha);
            ctx.fillStyle = this.color;
            ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size * 0.6);
            ctx.restore();
        }
    }

    class Shockwave {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            this.radius = 10;
            this.maxRadius = 450;
            this.alpha = 1;
        }
        update() {
            this.radius += 18;
            this.alpha = 1 - this.radius / this.maxRadius;
        }
        draw(ctx) {
            if (this.alpha <= 0) return;
            ctx.save();
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(239, 68, 68, ${this.alpha})`;
            ctx.lineWidth = 6;
            ctx.shadowBlur = 15;
            ctx.shadowColor = "#ef4444";
            ctx.stroke();
            ctx.restore();
        }
    }

    // Initialize ambient particles
    if (ctx) {
        for (let i = 0; i < 40; i++) {
            const p = new Particle();
            p.y = Math.random() * 1000;
            particles.push(p);
        }
    }

    function triggerConfettiBurst() {
        for (let i = 0; i < 90; i++) {
            confettis.push(new Confetti(400, 450));
        }
    }

    function triggerShockwaveBurst() {
        shockwaves.push(new Shockwave(400, 500));
    }

    function stopConfetti() {
        if (confettiIntervalId) {
            clearInterval(confettiIntervalId);
            confettiIntervalId = null;
        }
    }

    function renderLoop() {
        if (!ctx) return;
        ctx.clearRect(0, 0, 800, 1000);

        for (let i = 0; i < particles.length; i++) {
            particles[i].update();
            particles[i].draw(ctx);
        }

        for (let i = shockwaves.length - 1; i >= 0; i--) {
            shockwaves[i].update();
            shockwaves[i].draw(ctx);
            if (shockwaves[i].alpha <= 0) {
                shockwaves.splice(i, 1);
            }
        }

        for (let i = confettis.length - 1; i >= 0; i--) {
            confettis[i].update();
            confettis[i].draw(ctx);
            if (confettis[i].alpha <= 0 || confettis[i].y > 1050) {
                confettis.splice(i, 1);
            }
        }

        requestAnimationFrame(renderLoop);
    }
    if (ctx) renderLoop();

    // =========================================================
    // 2. STATE SYNC & DOM MANAGEMENT
    // =========================================================
    const views = {
        idle: document.getElementById("view-idle"),
        lobby: document.getElementById("view-lobby"),
        preparing: document.getElementById("view-preparing"),
        round: document.getElementById("view-round"),
        eliminating: document.getElementById("view-eliminating"),
        cooldown: document.getElementById("view-cooldown"),
        final: document.getElementById("view-final"),
        winner: document.getElementById("view-winner")
    };

    const arenaBadge = document.getElementById("arena-badge");
    const roundLabelText = document.getElementById("round-label-text");
    const headerAliveVal = document.getElementById("header-alive-val");
    const roundDots = document.getElementById("round-dots");

    const lobbyCountdownNumber = document.getElementById("lobby-countdown-number");
    const lobbyPlayersCount = document.getElementById("lobby-players-count");
    const lobbyProgressFill = document.getElementById("lobby-progress-fill");
    const radialProgressBar = document.getElementById("radial-progress-bar");
    const recentJoinedList = document.getElementById("recent-joined-list");

    const roundAliveRatio = document.getElementById("round-alive-ratio");
    const roundAliveFill = document.getElementById("round-alive-fill");
    const challengeBadge = document.getElementById("challenge-badge");
    const challengeTitle = document.getElementById("challenge-title");
    const challengeDesc = document.getElementById("challenge-desc");
    const challengePrompt = document.getElementById("challenge-prompt");
    const challengeTimerVal = document.getElementById("challenge-timer-val");
    const challengeTimerFill = document.getElementById("challenge-timer-fill");

    const eliminationStrobe = document.getElementById("elimination-strobe");
    const eliminatingResultDetail = document.getElementById("eliminating-result-detail");
    const elimCountVal = document.getElementById("elim-count-val");
    const survivorCountVal = document.getElementById("survivor-count-val");
    const victimsList = document.getElementById("victims-list");

    const finalModeBadge = document.getElementById("final-mode-badge");
    const finalDuelBox = document.getElementById("final-duel-box");
    const finalGeneralBox = document.getElementById("final-general-box");
    const duelP1Name = document.getElementById("duel-p1-name");
    const duelP1Points = document.getElementById("duel-p1-points");
    const duelP2Name = document.getElementById("duel-p2-name");
    const duelP2Points = document.getElementById("duel-p2-points");
    const finalAliveNum = document.getElementById("final-alive-num");

    const winnerUsername = document.getElementById("winner-username");
    const winnerStatPoints = document.getElementById("winner-stat-points");
    const winnerStatWins = document.getElementById("winner-stat-wins");
    const winnerStatRank = document.getElementById("winner-stat-rank");

    const idleLeaderboardList = document.getElementById("idle-leaderboard-list");

    // Preparing DOM elements
    const preparingCountdownNumber = document.getElementById("preparing-countdown-number");
    const preparingRadialProgress = document.getElementById("preparing-radial-progress");
    const preparingRoundNum = document.getElementById("preparing-round-num");
    const preparingChallengeTitle = document.getElementById("preparing-challenge-title");
    const preparingChallengeDesc = document.getElementById("preparing-challenge-desc");
    const preparingAliveCount = document.getElementById("preparing-alive-count");

    // Cooldown DOM elements
    const cooldownCountdownNumber = document.getElementById("cooldown-countdown-number");
    const cooldownRadialProgress = document.getElementById("cooldown-radial-progress");
    const cooldownRoundNum = document.getElementById("cooldown-round-num");
    const cooldownNextRound = document.getElementById("cooldown-next-round");
    const cooldownAliveCount = document.getElementById("cooldown-alive-count");
    const cooldownSurvivorsList = document.getElementById("cooldown-survivors-list");

    let lastRenderedView = null;
    let winnerCelebrated = false;
    let lastEliminationTrigger = 0;

    function switchView(activeViewKey) {
        if (lastRenderedView === activeViewKey) return;
        lastRenderedView = activeViewKey;

        // Reset confetti jika meninggalkan tampilan pemenang
        if (activeViewKey !== "winner") {
            winnerCelebrated = false;
            stopConfetti();
        }

        Object.keys(views).forEach(key => {
            if (!views[key]) return;
            if (key === activeViewKey) {
                views[key].classList.remove("hidden");
                views[key].classList.add("active");
            } else {
                views[key].classList.add("hidden");
                views[key].classList.remove("active");
            }
        });
    }

    function updateRoundDots(currentRound, totalRounds) {
        if (!roundDots) return;
        roundDots.innerHTML = "";
        const count = Math.max(1, totalRounds || 6);
        for (let i = 1; i <= count; i++) {
            const dot = document.createElement("div");
            dot.className = "round-dot";
            if (i < currentRound) {
                dot.classList.add("done");
            } else if (i === currentRound) {
                dot.classList.add("active");
            }
            roundDots.appendChild(dot);
        }
    }

    function render(state) {
        if (!state) return;

        const isGameActive = state.status && state.status !== "idle";
        const currentStatus = state.status || "idle";

        if (headerAliveVal) headerAliveVal.textContent = state.alive || 0;
        const totalRounds = Math.max(1, state.totalRounds || 6);
        const currentRound = state.round || (currentStatus === "lobby" ? 1 : 0);
        if (roundLabelText) roundLabelText.textContent = `ROUND 0${currentRound} / 0${totalRounds}`;
        updateRoundDots(currentRound, totalRounds);

        if (arenaBadge) {
            if (!isGameActive) {
                arenaBadge.textContent = "STANDBY";
                arenaBadge.className = "arena-badge badge-standby";
            } else if (currentStatus === "eliminating") {
                arenaBadge.textContent = "DANGER";
                arenaBadge.className = "arena-badge badge-danger";
            } else if (currentStatus === "cooldown") {
                arenaBadge.textContent = "PREPARING";
                arenaBadge.className = "arena-badge badge-cooldown";
            } else if (currentStatus === "preparing") {
                arenaBadge.textContent = "GET READY";
                arenaBadge.className = "arena-badge badge-preparing";
            } else {
                arenaBadge.textContent = "LIVE";
                arenaBadge.className = "arena-badge badge-active";
            }
        }

        switch (currentStatus) {
            case "idle": {
                switchView("idle");
                if (idleLeaderboardList && Array.isArray(state.leaderboard) && state.leaderboard.length > 0) {
                    idleLeaderboardList.innerHTML = state.leaderboard.slice(0, 5).map((p, idx) => `
                        <div class="leader-row">
                            <span>${idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}.`} ${escapeHTML(p.username)}</span>
                            <span class="pts">${p.totalPoints || 0} PTS (${p.wins || 0}W)</span>
                        </div>
                    `).join("");
                }
                break;
            }

            case "lobby": {
                switchView("lobby");
                const countdown = Math.max(0, state.countdown || 0);
                const totalCd = state.totalCountdown || 20;
                if (lobbyCountdownNumber) lobbyCountdownNumber.textContent = countdown;

                if (radialProgressBar) {
                    const circumference = 552.92;
                    const offset = circumference - (countdown / totalCd) * circumference;
                    radialProgressBar.style.strokeDashoffset = offset;
                }

                const count = state.players || 0;
                if (lobbyPlayersCount) lobbyPlayersCount.textContent = `${count} / 1000`;
                if (lobbyProgressFill) {
                    const progressPct = Math.min(100, (count / 1000) * 100);
                    lobbyProgressFill.style.width = `${progressPct}%`;
                }

                if (recentJoinedList && Array.isArray(state.recentJoined)) {
                    recentJoinedList.innerHTML = state.recentJoined.slice(-8).map(name => `
                        <div class="joined-tag">@${escapeHTML(name)}</div>
                    `).join("");
                }
                break;
            }

            case "preparing": {
                switchView("preparing");
                
                const prepCountdown = Math.max(0, state.countdown || 0);
                const prepTotalCd = state.totalCountdown || 30;
                const prepRound = state.nextRound || (state.round + 1) || 1;
                
                if (preparingCountdownNumber) preparingCountdownNumber.textContent = prepCountdown;
                if (preparingRoundNum) preparingRoundNum.textContent = prepRound;
                if (preparingAliveCount) preparingAliveCount.textContent = state.alive || 0;

                if (preparingRadialProgress) {
                    const circumference = 552.92;
                    const offset = circumference - (prepCountdown / prepTotalCd) * circumference;
                    preparingRadialProgress.style.strokeDashoffset = offset;
                }

                const ch = state.currentChallenge || {};
                if (preparingChallengeTitle) preparingChallengeTitle.textContent = ch.title || "TANTANGAN";
                if (preparingChallengeDesc) preparingChallengeDesc.textContent = ch.desc || "Bersiaplah untuk tantangan berikutnya!";
                break;
            }

            case "running": {
                const alive = state.alive || 0;
                const total = Math.max(1, state.players || 1);

                if (alive <= 2 && Array.isArray(state.finalPlayers) && state.finalPlayers.length === 2) {
                    switchView("final");
                    if (finalModeBadge) finalModeBadge.textContent = "⚔️ FINAL DUEL ⚔️";
                    if (finalDuelBox) finalDuelBox.classList.remove("hidden");
                    if (finalGeneralBox) finalGeneralBox.classList.add("hidden");

                    const p1 = state.finalPlayers[0];
                    const p2 = state.finalPlayers[1];
                    if (duelP1Name) duelP1Name.textContent = p1.username;
                    if (duelP1Points) duelP1Points.textContent = `+${p1.points || 0} PTS`;
                    if (duelP2Name) duelP2Name.textContent = p2.username;
                    if (duelP2Points) duelP2Points.textContent = `+${p2.points || 0} PTS`;
                } else if (alive <= 10) {
                    switchView("final");
                    if (finalModeBadge) finalModeBadge.textContent = alive === 3 ? "🔥 FINAL THREE 🔥" : `🔥 FINAL ${alive} 🔥`;
                    if (finalDuelBox) finalDuelBox.classList.add("hidden");
                    if (finalGeneralBox) finalGeneralBox.classList.remove("hidden");
                    if (finalAliveNum) finalAliveNum.textContent = alive;
                } else {
                    switchView("round");
                    const pct = Math.round((alive / total) * 100);
                    if (roundAliveRatio) roundAliveRatio.textContent = `${alive} / ${total} (${pct}%)`;
                    if (roundAliveFill) roundAliveFill.style.width = `${pct}%`;

                    const ch = state.currentChallenge || {};
                    if (challengeBadge) challengeBadge.textContent = ch.badge || "TANTANGAN";
                    if (challengeTitle) challengeTitle.textContent = ch.title || "SURVIVAL ROUND";
                    if (challengeDesc) challengeDesc.textContent = ch.desc || "Bertahanlah dari eliminasi arena!";
                    if (challengePrompt) challengePrompt.textContent = ch.prompt || "IKUTI INSTRUKSI DI CHAT!";

                    const cd = Math.max(0, state.countdown || 0);
                    const totalCd = ch.duration || 10;
                    if (challengeTimerVal) challengeTimerVal.textContent = `${cd}s`;
                    if (challengeTimerFill) {
                        const cdPct = (cd / totalCd) * 100;
                        challengeTimerFill.style.width = `${cdPct}%`;
                    }
                }
                break;
            }

            case "eliminating": {
                const now = Date.now();
                // Jalankan efek shockwave & strobe hanya sekali saat pertama kali berganti tampilan ke eliminating
                if (lastRenderedView !== "eliminating" || now - lastEliminationTrigger > 3000) {
                    lastEliminationTrigger = now;
                    if (eliminationStrobe) {
                        eliminationStrobe.classList.remove("hidden");
                        setTimeout(() => {
                            eliminationStrobe.classList.add("hidden");
                        }, 300);
                    }
                    triggerShockwaveBurst();
                }

                switchView("eliminating");

                if (elimCountVal) elimCountVal.textContent = state.lastEliminated ? state.lastEliminated.length : (state.eliminated || 0);
                if (survivorCountVal) survivorCountVal.textContent = state.alive || 0;

                const detail = state.currentChallenge?.detail || (state.currentChallenge ? `${state.currentChallenge.title} Telah Berakhir!` : "Eliminasi Berlangsung!");
                if (eliminatingResultDetail) eliminatingResultDetail.textContent = detail;

                if (victimsList && Array.isArray(state.lastEliminated)) {
                    victimsList.innerHTML = state.lastEliminated.map(p => `
                        <div class="victim-chip">
                            <span>@${escapeHTML(p.username)}</span>
                            <span class="rank">#${p.rank || "?"}</span>
                        </div>
                    `).join("");
                }
                break;
            }

            case "cooldown": {
                switchView("cooldown");
                
                const countdown = Math.max(0, state.countdown || 0);
                const totalCd = state.totalCountdown || 30;
                const nextRound = state.nextRound || (state.round + 1) || 2;
                
                if (cooldownCountdownNumber) cooldownCountdownNumber.textContent = countdown;
                if (cooldownRoundNum) cooldownRoundNum.textContent = nextRound;
                if (cooldownNextRound) cooldownNextRound.textContent = `RONDE ${nextRound} SEGERA DIMULAI`;
                if (cooldownAliveCount) cooldownAliveCount.textContent = state.alive || 0;

                // Radial progress for cooldown
                if (cooldownRadialProgress) {
                    const circumference = 552.92;
                    const offset = circumference - (countdown / totalCd) * circumference;
                    cooldownRadialProgress.style.strokeDashoffset = offset;
                }

                // Show survivors preview
                if (cooldownSurvivorsList && Array.isArray(state.recentJoined)) {
                    // Use alive players as survivors preview (limited to top 10 for display)
                    const survivors = state.recentJoined.slice(-10);
                    cooldownSurvivorsList.innerHTML = survivors.map(name => `
                        <div class="survivor-chip">@${escapeHTML(name)}</div>
                    `).join("");
                } else if (cooldownSurvivorsList && state.players && state.alive) {
                    // Fallback: just show count
                    cooldownSurvivorsList.innerHTML = `<div class="survivor-chip">${state.alive} pemain siap bertarung</div>`;
                }
                break;
            }

            case "winner": {
                switchView("winner");
                if (!winnerCelebrated) {
                    winnerCelebrated = true;
                    triggerConfettiBurst();
                    stopConfetti(); // Bersihkan interval yang ada sebelum membuat baru
                    confettiIntervalId = setInterval(triggerConfettiBurst, 2500);
                }

                if (state.winner) {
                    if (winnerUsername) winnerUsername.textContent = `@${state.winner.username}`;
                    const stats = state.winner.stats || {};
                    if (winnerStatPoints) winnerStatPoints.textContent = Number(stats.totalPoints || state.winner.points || 100).toLocaleString();
                    if (winnerStatWins) winnerStatWins.textContent = stats.wins || 1;
                    if (winnerStatRank) winnerStatRank.textContent = `#${stats.bestRank || 1}`;
                }
                break;
            }
        }
    }

    // =========================================================
    // 3. POLLING SYNC MECHANISM
    // =========================================================
    async function fetchState() {
        try {
            const res = await fetch("/api/siapa/state?t=" + Date.now(), { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                render(data);
                return;
            }
        } catch (_) {
            try {
                const res2 = await fetch("/state/overlay.json?t=" + Date.now(), { cache: "no-store" });
                if (res2.ok) {
                    const data2 = await res2.json();
                    if (data2 && data2.game === "siapa") {
                        render(data2);
                    }
                }
            } catch (err) {}
        }
    }

    fetchState();
    setInterval(fetchState, 350);

    // Initial Leaderboard Load
    async function loadInitialLeaderboard() {
        try {
            const res = await fetch("/api/siapa/leaderboard?limit=5", { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                if (data.success && Array.isArray(data.leaderboard) && idleLeaderboardList) {
                    idleLeaderboardList.innerHTML = data.leaderboard.map((p, idx) => `
                        <div class="leader-row">
                            <span>${idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}.`} ${escapeHTML(p.username)}</span>
                            <span class="pts">${p.totalPoints || 0} PTS (${p.wins || 0}W)</span>
                        </div>
                    `).join("");
                }
            }
        } catch (_) {}
    }
    loadInitialLeaderboard();

})();
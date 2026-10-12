// src/app/lifecycle.js
// Process signals and global exception handling
const botManager = require("./botManager");
const youtubeService = require("../integrations/youtube/youtubeService");
const tiktokService = require("../integrations/tiktok/tiktokService");
const { errMsg } = require("../core/utils/helpers");

function setupLifecycle(server) {
    process.on("uncaughtException", (err) => {
        const msg = errMsg(err);
        if (msg.includes("WebSocket was closed before the connection was established")) {
            // Abaikan error penutupan socket normal saat socket masih dalam fase handshake/abort
            return;
        }
        console.error("💥 [ERROR] Fatal Uncaught Exception:", msg);
    });

    process.on("unhandledRejection", (reason) => {
        const msg = errMsg(reason);
        if (msg.includes("WebSocket was closed before the connection was established")) {
            return;
        }
        console.error("💥 [ERROR] Unhandled Rejection:", msg);
    });

    function shutdown() {
        console.log("🛑 [BOOT] Mematikan bot...");
        botManager.stop();
        if (server && typeof server.close === "function") {
            server.close(() => process.exit(0));
        } else {
            process.exit(0);
        }
    }

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

module.exports = { setupLifecycle };

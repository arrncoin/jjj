// src/api/routes/liveChatRoutes.js
const express = require("express");
const controller = require("../controllers/liveChatController");

const router = express.Router();

// SSE Stream for Real-time OBS Overlays
router.get(["/api/chat/stream", "/overlay/chat/stream", "/overlay/chat/events"], controller.stream);

// REST Endpoints
router.get(["/api/chat/recent", "/overlay/chat/recent"], controller.getRecent);
router.post(["/api/chat/simulate", "/overlay/chat/simulate"], controller.simulate);
router.post(["/api/chat/clear", "/overlay/chat/clear"], controller.clear);

module.exports = router;

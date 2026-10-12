// src/api/routes/configRoutes.js
const express = require("express");
const controller = require("../controllers/configController");

const router = express.Router();

router.get("/api/config", controller.getConfig);
router.post("/api/config", controller.saveConfig);
router.post("/api/config/test-tiktok-key", controller.testTikTokKey);

module.exports = router;

const express = require("express");
const { getPrisma } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { buildNotificationEvents } = require("../services/notification.service");

const router = express.Router();

router.get("/events", requireAuth, async (req, res) => {
  const prisma = getPrisma();
  const now = new Date();
  const events = await buildNotificationEvents(prisma, req.user, {
    since: req.query.since,
    limit: req.query.limit,
    now,
  });

  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    serverTime: now.toISOString(),
    events,
  });
});

module.exports = router;

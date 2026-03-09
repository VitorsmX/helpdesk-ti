const express = require("express");
const bcrypt = require("bcryptjs");
const { getPrisma } = require("../db");

const router = express.Router();

router.get("/login", (req, res) => {
  res.render("auth/login", { title: "Login" });
});

router.post("/login", async (req, res) => {
  const prisma = getPrisma();
  const login = String(req.body.login || "").trim();
  const password = String(req.body.password || "");

  const user = await prisma.user.findUnique({
    where: { login },
    include: { usf: true },
  });

  if (!user || !user.ativo) {
    req.flash("error", "Login inválido ou usuário inativo.");
    return res.redirect("/login");
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    req.flash("error", "Login inválido.");
    return res.redirect("/login");
  }

  req.session.userId = user.id;
  res.redirect("/");
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

module.exports = router;

const test = require("node:test");
const assert = require("node:assert/strict");
const { passwordIsStrong } = require("../../src/utils/validation");
const { csvCell } = require("../../src/utils/security");
const {
  hashToken,
  createPasswordResetToken,
} = require("../../src/services/passwordReset.service");
const { passwordRecoveryEnabled } = require("../../src/services/mail.service");

test("passwordIsStrong requires length, letters and numbers", () => {
  assert.equal(passwordIsStrong("short1"), false);
  assert.equal(passwordIsStrong("somenteletras"), false);
  assert.equal(passwordIsStrong("123456789"), false);
  assert.equal(passwordIsStrong("SenhaSegura123"), true);
});

test("csvCell escapes formula prefixes and quotes", () => {
  assert.equal(csvCell("=cmd|calc"), "\"'=cmd|calc\"");
  assert.equal(csvCell('A "quoted" value'), '"A ""quoted"" value"');
});

test("password reset tokens are stored as sha256 hashes", () => {
  const token = "token-temporario-de-teste";
  const hashed = hashToken(token);
  assert.notEqual(hashed, token);
  assert.equal(hashed.length, 64);
  assert.equal(hashToken(token), hashed);
});

test("password recovery stays disabled when SMTP_ENABLED is false", async () => {
  const previous = {
    SMTP_ENABLED: process.env.SMTP_ENABLED,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
  };

  process.env.SMTP_ENABLED = "false";
  process.env.SMTP_HOST = "smtp.example.local";
  process.env.SMTP_USER = "user";
  process.env.SMTP_PASS = "pass";

  try {
    assert.equal(passwordRecoveryEnabled(), false);

    let created = false;
    const result = await createPasswordResetToken(
      {
        passwordResetToken: {
          create: async () => {
            created = true;
          },
        },
      },
      { id: 1, login: "admin", nome: "Admin", email: "admin@example.local" },
      {
        ip: "127.0.0.1",
        protocol: "http",
        get: (name) => (name === "host" ? "localhost:3000" : ""),
      },
    );

    assert.equal(created, false);
    assert.deepEqual(result, { delivered: false });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

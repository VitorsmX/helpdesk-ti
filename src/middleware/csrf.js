const csurf = require("@dr.pogodin/csurf");

const csrfProtection = csurf();

function csrfSetup(req, res, next) {
  csrfProtection(req, res, (err) => {
    if (err) return next(err);

    res.locals.csrfToken = req.csrfToken();

    next();
  });
}

module.exports = { csrfSetup };

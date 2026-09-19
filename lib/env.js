/* =============================================================================
   Charge .env.local puis .env dans process.env, sans dépendance.
   Une variable déjà définie (Vercel, terminal) n'est jamais écrasée.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

['.env.local', '.env'].forEach(function (name) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) return;
    let value = match[2];
    const quoted = value.match(/^(['"])(.*)\1$/);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '');
    process.env[match[1]] = value;
  });
});

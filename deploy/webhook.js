const http = require('node:http');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const PORT = parseInt(process.env.PORT || '9000', 10);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!WEBHOOK_SECRET) {
  console.error('FATAL: WEBHOOK_SECRET env var is required');
  process.exit(1);
}

const DEPLOY_SCRIPT = `${__dirname}/deploy.sh`;

function verifySignature(payload, signature) {
  if (!signature) return false;
  const expected = `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function runDeploy() {
  return new Promise((resolve, reject) => {
    execFile('bash', [DEPLOY_SCRIPT], { timeout: 300_000 }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[deploy] FAILED: ${err.message}`);
        console.error(stderr);
        reject(err);
      } else {
        console.log(stdout);
        resolve(stdout);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Only accept POST /webhook
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  // Verify signature
  const signature = req.headers['x-hub-signature-256'];
  if (!verifySignature(body, signature)) {
    console.warn(`[webhook] 403 — invalid signature from ${req.socket.remoteAddress}`);
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Parse event
  let event;
  try {
    event = JSON.parse(body.toString());
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  // Only deploy on push to main
  const ref = event.ref || '';
  if (ref !== 'refs/heads/main') {
    console.log(`[webhook] Ignored push to ${ref}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ignored', ref }));
    return;
  }

  // Deploy
  console.log(`[webhook] Push to main detected — starting deploy`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'deploying' }));

  try {
    await runDeploy();
    console.log('[webhook] Deploy completed successfully');
  } catch (err) {
    console.error(`[webhook] Deploy failed: ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`[webhook] Listening on port ${PORT}`);
});

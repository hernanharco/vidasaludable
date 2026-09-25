#!/bin/bash
# Webhook deploy server usando Python (más robusto que bash puro)
exec python3 - "$@" << 'PYTHON'
import http.server
import json
import subprocess
import os
import hmac
import hashlib

PORT = int(os.environ.get('PORT', 9000))
SECRET = os.environ.get('WEBHOOK_SECRET', '')
OPT_DIR = os.environ.get('OPT_DIR', '/opt')
LOG = '/var/log/deploy-webhook.log'

def log(msg):
    with open(LOG, 'a') as f:
        from datetime import datetime
        f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")

def verify_signature(payload, signature):
    if not SECRET:
        return True
    expected = 'sha256=' + hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

def deploy(repo):
    project_dir = f"{OPT_DIR}/{repo}"
    log(f"Deploying {repo}")
    try:
        subprocess.run(['git', 'fetch', 'origin'], cwd=project_dir, capture_output=True)
        subprocess.run(['git', 'reset', '--hard', 'origin/main'], cwd=project_dir, capture_output=True)
        compose_file = f"{project_dir}/compose.prod.yaml"
        if os.path.exists(compose_file):
            subprocess.run(['docker', 'compose', '-f', 'compose.prod.yaml', 'up', '-d', '--build'], cwd=project_dir, capture_output=True)
        log(f"Deploy complete for {repo}")
    except Exception as e:
        log(f"Error deploying {repo}: {e}")

class WebhookHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/webhook':
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode()

        signature = self.headers.get('X-Hub-Signature-256', '')
        if not verify_signature(body, signature):
            log("Invalid signature")
            self.send_response(403)
            self.end_headers()
            return

        try:
            data = json.loads(body)
            repo = data.get('full_name', '')
            ref = data.get('ref', '')

            if ref == 'refs/heads/main' and repo:
                log(f"Push to main: {repo}")
                self.send_response(200)
                self.end_headers()
                deploy(repo)
            else:
                log(f"Ignored: {ref} from {repo}")
                self.send_response(200)
                self.end_headers()
        except Exception as e:
            log(f"Error: {e}")
            self.send_response(200)
            self.end_headers()

    def log_message(self, format, *args):
        pass

log(f"Webhook server started on port {PORT}")
server = http.server.HTTPServer(('0.0.0.0', PORT), WebhookHandler)
server.serve_forever()
PYTHON

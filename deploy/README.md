# Deploy Webhook

Servidor webhook que ejecuta deploy automático al recibir un push a `main` desde GitHub.

## Instalación en el servidor

### 1. Copiar archivos

```bash
scp -r deploy/ root@tu-servidor:/opt/deploy-webhook
ssh root@tu-servidor
cd /opt/deploy-webhook
```

### 2. Instalar dependencias

```bash
npm install --production
```

### 3. Configurar variables de entorno

Crear `/opt/deploy-webhook/.env`:

```bash
PORT=9000
WEBHOOK_SECRET=tu-secret-aqui-generar-con-openssl-rand-hex-32
PROJECT_DIR=/opt/vidasaludable
```

Generar un secret seguro:

```bash
openssl rand -hex 32
```

### 4. Crear servicio systemd

Crear `/etc/systemd/system/deploy-webhook.service`:

```ini
[Unit]
Description=VidaSaludable Deploy Webhook
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/deploy-webhook
ExecStart=/usr/bin/node webhook.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/deploy-webhook/.env

[Install]
WantedBy=multi-user.target
```

Habilitar e iniciar:

```bash
systemctl daemon-reload
systemctl enable deploy-webhook
systemctl start deploy-webhook
```

### 5. Configurar webhook en GitHub

1. Ir a Settings → Webhooks → Add webhook
2. **Payload URL:** `http://tu-servidor:9000/webhook`
3. **Content type:** `application/json`
4. **Secret:** el mismo valor de `WEBHOOK_SECRET`
5. **Events:** seleccionar "Just the push event"
6. Guardar

### 6. Abrir el puerto

```bash
# UFW
ufw allow 9000/tcp

# o iptables
iptables -A INPUT -p tcp --dport 9000 -j ACCEPT
```

### 7. Probar

```bash
# Verificar que el servidor responde
curl http://localhost:9000/health

# Simular un webhook (requiere header de firma válido)
PAYLOAD='{"ref":"refs/heads/main"}'
SECRET=$(grep WEBHOOK_SECRET /opt/deploy-webhook/.env | cut -d= -f2)
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
curl -X POST http://localhost:9000/webhook \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$SIGNATURE" \
  -d "$PAYLOAD"
```

## Archivos

| Archivo | Descripción |
|---------|-------------|
| `webhook.js` | Servidor HTTP que valida y dispara deploys |
| `deploy.sh` | Script de deploy (git pull + docker compose) |
| `package.json` | Dependencias del paquete |
| `.env` | Variables de entorno (no commitear) |

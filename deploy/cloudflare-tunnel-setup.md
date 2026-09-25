# Cloudflare Tunnel — Webhook Deploy

Exponer el webhook de deploy (`webhook.js`, puerto 9000) sin abrir puertos en el firewall usando Cloudflare Tunnel (formerly Argo Tunnel).

**Resultado final:** `https://webhook.vidasaludable.rincom.es/webhook` → `localhost:9000/webhook`

---

## Prerequisitos

- Servidor Hetzner con Ubuntu 24.04
- Dominio `vidasaludable.rincom.es` gestionado en Cloudflare (o al menos el subdominio `rincom.es` delegado a Cloudflare nameservers)
- Webhook ya instalado y corriendo en `/opt/deploy-webhook` (ver `README.md`)

---

## 1. Instalar `cloudflared`

```bash
# Agregar repo oficial de Cloudflare
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared noble main" | sudo tee /etc/apt/sources.list.d/cloudflared.list

sudo apt update && sudo apt install -y cloudflared
```

Verificar:

```bash
cloudflared --version
# cloudflared version 2024.x.x (o posterior)
```

---

## 2. Autenticar con Cloudflare

```bash
sudo cloudflared tunnel login
```

Esto abre un navegador (o imprime una URL). Autorizar el acceso al dominio. Se crea `~/.cloudflared/cert.pem`.

---

## 3. Crear el tunnel

```bash
sudo cloudflared tunnel create vidasaludable-webhook
```

Esto genera un UUID de tunnel. Guardar la salida:

```
Created tunnel vidasaludable-webhook with id <TUNNEL_UUID>
```

Anotar el `<TUNNEL_UUID>` — se usa en los pasos siguientes.

---

## 4. Configurar DNS del tunnel

```bash
sudo cloudflared tunnel route dns vidasaludable-webhook webhook.vidasaludable.rincom.es
```

Esto crea el registro CNAME en Cloudflare apuntando al tunnel.

---

## 5. Crear el archivo de configuración

```bash
sudo mkdir -p /etc/cloudflared
sudo tee /etc/cloudflared/config.yml <<EOF
tunnel: <TUNNEL_UUID>
credentials-file: /root/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: webhook.vidasaludable.rincom.es
    service: http://localhost:9000
    originRequest:
      noTLSVerify: false
  - service: http_status:404
EOF
```

Reemplazar `<TUNNEL_UUID>` con el UUID real del paso 3.

El último `- service: http_status:404` es obligatorio: Cloudflare requiere un catch-all al final de la lista de ingress.

---

## 6. Probar el tunnel

```bash
sudo cloudflared tunnel run vidasaludable-webhook
```

En otro terminal o desde fuera:

```bash
curl https://webhook.vidasaludable.rincom.es/health
# {"status":"ok"}
```

Si funciona, Ctrl+C para detener y continuar con el servicio systemd.

---

## 7. Servicio systemd para `cloudflared`

```bash
sudo tee /etc/systemd/system/cloudflared-webhook.service <<EOF
[Unit]
Description=Cloudflare Tunnel — vidasaludable-webhook
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/cloudflared tunnel --config /etc/cloudflared/config.yml run vidasaludable-webhook
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
```

Habilitar e iniciar:

```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudflared-webhook
sudo systemctl start cloudflared-webhook
```

Verificar estado:

```bash
sudo systemctl status cloudflared-webhook
journalctl -u cloudflared-webhook -f
```

---

## 8. Actualizar el webhook en GitHub

El webhook del repositorio sigue apuntando a la URL pública, ahora vía HTTPS en Cloudflare.

Opción A — actualizar el webhook existente vía API:

```bash
export GITHUB_TOKEN="ghp_tu_token"

curl -X PATCH \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/hernanharco/vidasaludable/hooks/<HOOK_ID>" \
  -d '{
    "config": {
      "url": "https://webhook.vidasaludable.rincom.es/webhook",
      "content_type": "json",
      "secret": "tu_WEBHOOK_SECRET"
    }
  }' | python3 -m json.tool
```

Opción B — crear un webhook nuevo:

```bash
export GITHUB_TOKEN="ghp_tu_token"

curl -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/hernanharco/vidasaludable/hooks" \
  -d '{
    "name": "web",
    "active": true,
    "events": ["push"],
    "config": {
      "url": "https://webhook.vidasaludable.rincom.es/webhook",
      "content_type": "json",
      "secret": "tu_WEBHOOK_SECRET"
    }
  }' | python3 -m json.tool
```

Opción C — manual en GitHub UI:

1. Settings → Webhooks → Edit webhook
2. **Payload URL:** `https://webhook.vidasaludable.rincom.es/webhook`
3. **Secret:** el mismo que `WEBHOOK_SECRET` en `/opt/deploy-webhook/.env`
4. Guardar

---

## 9. Verificar end-to-end

```bash
# 1. Health check externo
curl -I https://webhook.vidasaludable.rincom.es/health

# 2. Verificar que el tunnel está corriendo
sudo systemctl status cloudflared-webhook

# 3. Verificar que el webhook está corriendo
sudo systemctl status deploy-webhook

# 4. Logs del tunnel
journalctl -u cloudflared-webhook --since "10 min ago"

# 5. Simular un push (desde tu máquina local con gh CLI)
gh api repos/hernanharco/vidasaludable/dispatches \
  -X POST \
  -f event_type=deploy-test
```

---

## 10. Seguridad

### Qué se expone

Solo `https://webhook.vidasaludable.rincom.es/webhook` y `/health`. Cloudflare Tunnel no abre puertos en el servidor — la conexión sale hacia Cloudflare, no entra.

### Firmas HMAC

El webhook sigue verificando `X-Hub-Signature-256`. Cloudflare no modifica este header, así que la verificación funciona igual.

### IP allowlist (opcional)

En el Dashboard de Cloudflare → Security → WAF, crear una regla:

```
(http.request.uri.path eq "/webhook" and not ip.src in {<IP_DE_GITHUB})
```

Acción: Block. Esto filtra tráfico no-GitHub al endpoint `/webhook`.

### Rate limiting (opcional)

En Cloudflare Dashboard → Security → Bots → Bot Fight Mode, o crear una regla de rate limiting en WAF:

```
(http.request.uri.path eq "/webhook" and http.request.method eq "POST")
```

---

## Troubleshooting

### cloudflared no arranca

```bash
# Verificar que el cert.pem existe
ls -la /root/.cloudflared/

# Verificar que el config.yml tiene el UUID correcto
sudo cat /etc/cloudflared/config.yml

# Logs detallados
journalctl -u cloudflared-webhook -e
```

### 502 Bad Gateway

- Verificar que el webhook corre en el puerto correcto: `curl http://localhost:9000/health`
- Verificar el servicio: `sudo systemctl status deploy-webhook`

### Timeout en GitHub webhook delivery

- Verificar que el dominio resuelve: `dig webhook.vidasaludable.rincom.es`
- Verificar que el tunnel está activo: `sudo systemctl status cloudflared-webhook`
- Revisar logs de cloudflared para errores de conexión

### Webhook recibe requests pero no deploya

```bash
# Verificar logs del webhook
journalctl -u deploy-webhook -f

# Verificar que deploy.sh existe y es ejecutable
ls -la /opt/deploy-webhook/deploy.sh
```

---

## Referencia rápida

| Componente | Ubicación |
|---|---|
| Tunnel config | `/etc/cloudflared/config.yml` |
| Tunnel credentials | `/root/.cloudflared/<TUNNEL_UUID>.json` |
| Cloudflare cert | `/root/.cloudflared/cert.pem` |
| Tunnel service | `cloudflared-webhook.service` |
| Webhook service | `deploy-webhook.service` |
| Webhook source | `/opt/deploy-webhook/webhook.js` |
| Public URL | `https://webhook.vidasaludable.rincom.es` |

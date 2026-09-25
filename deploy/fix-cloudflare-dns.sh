#!/bin/bash
# Fix Cloudflare DNS records for vidasaludable
# The tunnel route created wrong CNAMEs (appending .elrincondeharco.com)
# We need to create the correct ones manually

CLOUDFLARE_TOKEN=""
ZONE_ID=""
TUNNEL_ID="3d831f1d-ba43-4dbb-ac7f-d2a6a4b522c5"
TUNNEL_CNAME="3d831f1d-ba43-4dbb-ac7f-d2a6a4b522c5.cfargotunnel.com"

if [ -z "$CLOUDFLARE_TOKEN" ]; then
    echo "Set CLOUDFLARE_TOKEN first"
    exit 1
fi

# Create correct CNAME records
for SUBDOMAIN in api webhook; do
    FQDN="${SUBDOMAIN}.vidasaludable.rincom.es"
    echo "Creating DNS record for $FQDN..."
    curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
      -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{
        \"type\": \"CNAME\",
        \"name\": \"${SUBDOMAIN}\",
        \"content\": \"${TUNNEL_CNAME}\",
        \"proxied\": true
      }" | python3 -m json.tool
done

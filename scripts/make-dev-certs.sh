#!/usr/bin/env bash
# Generates the self-signed certificate that server.js picks up to serve HTTPS
# locally. Only for development: Azure terminates TLS at its own front end, and
# certs/ is gitignored so these files never reach it.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p certs

# The LAN address is included so the same certificate also covers testing from a
# phone on the same network, where localhost is not a secure context and APIs
# like the clipboard would otherwise be unavailable.
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
SAN="DNS:localhost,IP:127.0.0.1,IP:::1"
if [ -n "$LAN_IP" ]; then
  SAN="$SAN,IP:$LAN_IP"
fi

openssl req -x509 -newkey rsa:2048 -sha256 -nodes \
  -days 825 \
  -keyout certs/localhost-key.pem \
  -out certs/localhost-cert.pem \
  -subj "/CN=localhost" \
  -addext "subjectAltName=$SAN" \
  -addext "basicConstraints=critical,CA:FALSE" \
  2>/dev/null

chmod 600 certs/localhost-key.pem

echo "Certificate written to certs/ for $SAN"
echo "Browsers will warn once: it is self-signed. Accept it, or trust it with"
echo "  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain certs/localhost-cert.pem"

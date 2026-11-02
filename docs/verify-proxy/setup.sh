#!/usr/bin/env bash
# Sincerely free email verification server.
#
# Turns a fresh Ubuntu 22.04 or 24.04 VPS into a private SOCKS5 proxy that
# only does one thing: lets the Sincerely server open SMTP connections on
# port 25, which Render blocks. Nothing is ever sent through it; the mailbox
# check stops at RCPT TO.
#
# Easiest: paste this whole file into the provider's "Cloud config" or
# "User data" box when creating the server. Or copy it onto the server and
# run it as root: bash setup.sh
#
# Optional, before running:
#   HELO_NAME=verify.usesincerely.com   the name this server will answer to
#   ALLOW_FROM=1.2.3.4,5.6.7.8          only these IPs may use the proxy
set -euo pipefail

HELO_NAME="${HELO_NAME:-verify.usesincerely.com}"
PROXY_PORT="${PROXY_PORT:-1080}"
PROXY_USER="sincerely"
ALLOW_FROM="${ALLOW_FROM:-}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y dante-server ufw openssl netcat-openbsd

hostnamectl set-hostname "$HELO_NAME" || true

# The proxy logs in with an ordinary system account that cannot log in to
# the server itself.
PASS="$(openssl rand -hex 18)"
id "$PROXY_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$PROXY_USER"
echo "${PROXY_USER}:${PASS}" | chpasswd

IFACE="$(ip route show default | awk '/default/ {print $5; exit}')"
PUBLIC_IP="$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')"

cat > /etc/danted.conf <<CONF
logoutput: syslog
internal: 0.0.0.0 port = ${PROXY_PORT}
external: ${IFACE}
socksmethod: username
user.privileged: root
user.unprivileged: nobody

client pass {
  from: 0.0.0.0/0 to: 0.0.0.0/0
  log: error
}

# Port 25 only. This server is for checking mailboxes, not for relaying
# anything else, and an open proxy would be abused within hours.
socks pass {
  from: 0.0.0.0/0 to: 0.0.0.0/0 port = 25
  command: connect
  protocol: tcp
  log: error
}
socks block {
  from: 0.0.0.0/0 to: 0.0.0.0/0
  log: connect error
}
CONF

systemctl enable danted
systemctl restart danted

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
if [ -n "$ALLOW_FROM" ]; then
  IFS=',' read -ra SRC <<< "$ALLOW_FROM"
  for ip in "${SRC[@]}"; do ufw allow from "$ip" to any port "$PROXY_PORT" proto tcp; done
else
  ufw allow "${PROXY_PORT}/tcp"
fi
ufw --force enable

# Can this server reach port 25 at all? Many providers block it until asked.
if timeout 8 nc -z gmail-smtp-in.l.google.com 25 2>/dev/null; then
  PORT25="OPEN - ready to use"
else
  PORT25="BLOCKED - ask your provider to unblock outbound port 25 for this server"
fi

cat > /root/sincerely-proxy.txt <<OUT
Sincerely verification server is set up.

Outbound port 25: ${PORT25}
Public IP:        ${PUBLIC_IP}

Put these three on Render (Environment for the Sincerely server):

VERIFY_SMTP_PROXY=socks5://${PROXY_USER}:${PASS}@${PUBLIC_IP}:${PROXY_PORT}
VERIFY_HELO_NAME=${HELO_NAME}
VERIFY_FROM_EMAIL=verify@${HELO_NAME#*.}

Then, in your DNS and at your server provider:
  1. DNS: an A record ${HELO_NAME} -> ${PUBLIC_IP}
  2. Provider panel: set reverse DNS (PTR) for ${PUBLIC_IP} to ${HELO_NAME}
OUT

echo
cat /root/sincerely-proxy.txt
echo "(Saved to /root/sincerely-proxy.txt)"

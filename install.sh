#!/usr/bin/env bash
# Instalador do Velix para Ubuntu (20.04+/22.04/24.04).
# Uso:
#   curl -fsSL https://raw.githubusercontent.com/Jhonata-php/velix/main/install.sh | sudo bash
# ou, com o repositório já clonado:
#   sudo REPO_DIR=$(pwd) ./install.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Jhonata-php/velix.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/velix}"
REPO_DIR="${REPO_DIR:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode este script como root (sudo)." >&2
  exit 1
fi

echo "==> Verificando Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

if ! docker compose version >/dev/null 2>&1; then
  echo "Plugin docker compose não encontrado. Instale 'docker-compose-plugin' e rode novamente." >&2
  exit 1
fi

echo "==> Obtendo o código do Velix"
if [ -n "$REPO_DIR" ]; then
  cp -r "$REPO_DIR" "$INSTALL_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

echo "==> Gerando .env"
if [ ! -f .env ]; then
  SERVER_IP="$(curl -fsSL ifconfig.me || echo SEU_IP)"
  cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
VELIX_CREDENTIAL_SECRET=$(openssl rand -hex 32)
WEB_ORIGIN=http://${SERVER_IP}:3000
NEXT_PUBLIC_API_URL=http://${SERVER_IP}:3001/api
VELIX_ADMIN_EMAIL=admin@velix.local
VELIX_ADMIN_PASSWORD=$(openssl rand -hex 8)
EOF
  echo "Arquivo .env criado com segredos aleatórios."
else
  echo ".env já existe, mantendo o atual."
fi

echo "==> Subindo os containers (isso pode levar alguns minutos na primeira vez)"
docker compose up -d --build

echo "==> Pronto"
set -a; source .env; set +a
echo "Painel:  http://${SERVER_IP:-$(hostname -I | awk '{print $1}')}:3000"
echo "API:     http://${SERVER_IP:-$(hostname -I | awk '{print $1}')}:3001/api"
echo "Login:   ${VELIX_ADMIN_EMAIL}"
echo "Senha:   ${VELIX_ADMIN_PASSWORD}"
echo "(credenciais também salvas em ${INSTALL_DIR}/.env)"

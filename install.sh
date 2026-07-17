#!/usr/bin/env bash

# ============================================================
# Velix Installer
# Ubuntu 20.04 / 22.04 / 24.04
#
# Instalação:
#
# curl -fsSL \
#   https://raw.githubusercontent.com/Jhonata-php/velix/main/install.sh \
#   | sudo bash
#
# Instalação usando repositório local:
#
# sudo REPO_DIR="$(pwd)" ./install.sh
# ============================================================

set -Eeuo pipefail

# ============================================================
# CONFIGURAÇÕES
# ============================================================

REPO_URL="${REPO_URL:-https://github.com/Jhonata-php/velix.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/velix}"
REPO_DIR="${REPO_DIR:-}"

DEFAULT_ADMIN_EMAIL="${VELIX_ADMIN_EMAIL:-admin@velix.local}"
DEFAULT_PANEL_PORT="${VELIX_HTTP_PORT:-3000}"

ENV_FILE="${INSTALL_DIR}/.env"
OVERRIDE_FILE="${INSTALL_DIR}/docker-compose.override.yml"
SYSTEMD_FILE="/etc/systemd/system/velix.service"

SERVER_IP=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
GENERATED_ADMIN_PASSWORD="false"

USE_DOMAIN="false"
VELIX_DOMAIN=""
ACME_EMAIL=""
PANEL_PORT="$DEFAULT_PANEL_PORT"
WEB_ORIGIN=""

# ============================================================
# CORES
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

info() {
    echo -e "${BLUE}==>${NC} $*"
}

success() {
    echo -e "${GREEN}✔${NC} $*"
}

warning() {
    echo -e "${YELLOW}⚠${NC} $*"
}

error() {
    echo -e "${RED}✖${NC} $*" >&2
}

fatal() {
    error "$*"
    exit 1
}

section() {
    echo
    echo -e "${PURPLE}────────────────────────────────────────────────────────────${NC}"
    echo -e "${BOLD}$*${NC}"
    echo -e "${PURPLE}────────────────────────────────────────────────────────────${NC}"
    echo
}

# ============================================================
# TRATAMENTO DE ERROS
# ============================================================

on_error() {
    local exit_code=$?
    local line_number="${1:-desconhecida}"

    echo
    error "A instalação falhou."
    error "Linha aproximada: ${line_number}"
    error "Código de saída: ${exit_code}"

    if command -v docker >/dev/null 2>&1; then
        echo
        warning "Estado atual dos containers:"

        docker ps -a \
            --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' \
            2>/dev/null || true
    fi

    if [ -d "$INSTALL_DIR" ]; then
        echo
        warning "Consulte os logs executando:"
        echo
        echo "  cd ${INSTALL_DIR}"
        echo "  docker compose logs --tail=300"
    fi

    exit "$exit_code"
}

trap 'on_error $LINENO' ERR

# ============================================================
# INTERAÇÃO PELO TERMINAL
# Funciona mesmo usando curl | sudo bash
# ============================================================

ask() {
    local prompt="$1"
    local default_value="${2:-}"
    local answer=""

    if [ ! -e /dev/tty ]; then
        echo "$default_value"
        return
    fi

    if [ -n "$default_value" ]; then
        read -r -p "$(echo -e "${CYAN}?${NC} ${prompt} [${default_value}]: ")" \
            answer </dev/tty

        echo "${answer:-$default_value}"
    else
        read -r -p "$(echo -e "${CYAN}?${NC} ${prompt}: ")" \
            answer </dev/tty

        echo "$answer"
    fi
}

ask_secret() {
    local prompt="$1"
    local answer=""

    if [ ! -e /dev/tty ]; then
        echo ""
        return
    fi

    read -r -s -p "$(echo -e "${CYAN}?${NC} ${prompt}: ")" \
        answer </dev/tty

    echo >/dev/tty
    echo "$answer"
}

ask_yes_no() {
    local prompt="$1"
    local default_value="${2:-n}"
    local answer=""

    if [ ! -e /dev/tty ]; then
        [ "$default_value" = "s" ]
        return
    fi

    if [ "$default_value" = "s" ]; then
        read -r -p "$(echo -e "${CYAN}?${NC} ${prompt} [S/n]: ")" \
            answer </dev/tty

        answer="${answer:-s}"
    else
        read -r -p "$(echo -e "${CYAN}?${NC} ${prompt} [s/N]: ")" \
            answer </dev/tty

        answer="${answer:-n}"
    fi

    case "${answer,,}" in
        s|sim|y|yes)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# ============================================================
# BANNER
# ============================================================

show_banner() {
    clear 2>/dev/null || true

    echo -e "${PURPLE}${BOLD}"

    cat <<'EOF'
██╗   ██╗███████╗██╗     ██╗██╗  ██╗
██║   ██║██╔════╝██║     ██║╚██╗██╔╝
██║   ██║█████╗  ██║     ██║ ╚███╔╝
╚██╗ ██╔╝██╔══╝  ██║     ██║ ██╔██╗
 ╚████╔╝ ███████╗███████╗██║██╔╝ ██╗
  ╚═══╝  ╚══════╝╚══════╝╚═╝╚═╝  ╚═╝

 Plataforma de infraestrutura, aplicações e automação
EOF

    echo -e "${NC}"
    echo -e "${GRAY}Instalador oficial do Velix${NC}"
}

# ============================================================
# VALIDAÇÕES
# ============================================================

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        fatal "Execute este instalador como root ou utilizando sudo."
    fi
}

validate_os() {
    if [ ! -f /etc/os-release ]; then
        fatal "Não foi possível identificar o sistema operacional."
    fi

    # shellcheck disable=SC1091
    source /etc/os-release

    case "${ID:-}" in
        ubuntu|debian)
            success "Sistema detectado: ${PRETTY_NAME}"
            ;;
        *)
            warning "Sistema detectado: ${PRETTY_NAME:-desconhecido}"
            warning "Este instalador foi desenvolvido para Ubuntu e Debian."
            ;;
    esac
}

validate_email() {
    local email="$1"

    if [[ ! "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
        fatal "E-mail inválido: ${email}"
    fi
}

validate_domain() {
    local domain="$1"

    if [[ ! "$domain" =~ ^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$ ]]; then
        fatal "Domínio inválido: ${domain}"
    fi
}

validate_port() {
    local port="$1"

    if ! [[ "$port" =~ ^[0-9]+$ ]]; then
        fatal "A porta deve ser um número."
    fi

    if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
        fatal "Porta inválida: ${port}"
    fi
}

validate_password() {
    local password="$1"

    if [ "${#password}" -lt 8 ]; then
        fatal "A senha precisa ter pelo menos 8 caracteres."
    fi
}

# ============================================================
# DEPENDÊNCIAS
# ============================================================

install_dependencies() {
    section "Instalando dependências"

    export DEBIAN_FRONTEND=noninteractive

    apt-get update -y

    apt-get install -y \
        ca-certificates \
        curl \
        dnsutils \
        git \
        gnupg \
        jq \
        lsb-release \
        openssl \
        rsync \
        ufw

    success "Dependências instaladas"
}

# ============================================================
# IP PÚBLICO
# ============================================================

detect_public_ip() {
    section "Detectando IP público"

    SERVER_IP="$(
        curl -4 -fsSL --connect-timeout 8 https://api.ipify.org 2>/dev/null ||
        curl -4 -fsSL --connect-timeout 8 https://ifconfig.me 2>/dev/null ||
        hostname -I 2>/dev/null | awk '{print $1}' ||
        true
    )"

    if [ -z "$SERVER_IP" ]; then
        SERVER_IP="127.0.0.1"
        warning "Não foi possível detectar o IP público automaticamente."
    else
        success "IP detectado: ${SERVER_IP}"
    fi
}

# ============================================================
# COLETA DE CONFIGURAÇÕES
# ============================================================

collect_configuration() {
    section "Configuração inicial"

    INSTALL_DIR="$(ask "Diretório de instalação" "$INSTALL_DIR")"

    ADMIN_EMAIL="$(ask \
        "E-mail inicial do administrador" \
        "$DEFAULT_ADMIN_EMAIL")"

    validate_email "$ADMIN_EMAIL"

    ADMIN_PASSWORD="$(ask_secret \
        "Senha do administrador, deixe vazio para gerar automaticamente")"

    if [ -z "$ADMIN_PASSWORD" ]; then
        ADMIN_PASSWORD="$(
            openssl rand -base64 32 |
            tr -d '/+=' |
            cut -c1-18
        )"

        GENERATED_ADMIN_PASSWORD="true"
    else
        validate_password "$ADMIN_PASSWORD"
    fi

    if ask_yes_no \
        "Deseja acessar o Velix através de um domínio com SSL?" \
        "s"; then

        USE_DOMAIN="true"

        while true; do
            VELIX_DOMAIN="$(ask \
                "Domínio do painel, sem http:// ou https://" \
                "")"

            if [[ "$VELIX_DOMAIN" =~ ^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$ ]]; then
                break
            fi

            warning "Domínio inválido. Exemplo: velix.seudominio.com.br"
        done

        ACME_EMAIL="$(ask \
            "E-mail para emissão do certificado SSL" \
            "$ADMIN_EMAIL")"

        validate_email "$ACME_EMAIL"

        WEB_ORIGIN="https://${VELIX_DOMAIN}"
        PANEL_PORT="3000"
    else
        USE_DOMAIN="false"

        PANEL_PORT="$(ask \
            "Porta de acesso ao painel" \
            "$DEFAULT_PANEL_PORT")"

        validate_port "$PANEL_PORT"

        VELIX_DOMAIN=""
        ACME_EMAIL=""
        WEB_ORIGIN="http://${SERVER_IP}:${PANEL_PORT}"
    fi

    section "Resumo da instalação"

    echo "Diretório:       ${INSTALL_DIR}"
    echo "IP do servidor:  ${SERVER_IP}"
    echo "Administrador:   ${ADMIN_EMAIL}"

    if [ "$USE_DOMAIN" = "true" ]; then
        echo "Domínio:         ${VELIX_DOMAIN}"
        echo "URL:             ${WEB_ORIGIN}"
        echo "SSL:             Let's Encrypt"
    else
        echo "Domínio:         não configurado"
        echo "Porta:           ${PANEL_PORT}"
        echo "URL:             ${WEB_ORIGIN}"
    fi

    echo

    if ! ask_yes_no "Confirma a instalação?" "s"; then
        fatal "Instalação cancelada."
    fi
}

# ============================================================
# DOCKER
# ============================================================

install_docker() {
    section "Instalando Docker"

    if ! command -v docker >/dev/null 2>&1; then
        info "Docker não encontrado. Iniciando instalação."

        install -m 0755 -d /etc/apt/keyrings

        curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
            -o /etc/apt/keyrings/docker.asc

        chmod a+r /etc/apt/keyrings/docker.asc

        # shellcheck disable=SC1091
        source /etc/os-release

        echo \
            "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
            > /etc/apt/sources.list.d/docker.list

        apt-get update -y

        apt-get install -y \
            docker-ce \
            docker-ce-cli \
            containerd.io \
            docker-buildx-plugin \
            docker-compose-plugin
    fi

    systemctl enable --now docker

    if ! docker compose version >/dev/null 2>&1; then
        fatal "O plugin Docker Compose não foi encontrado."
    fi

    success "$(docker --version)"
    success "$(docker compose version)"
}

# ============================================================
# CÓDIGO DO VELIX
# ============================================================

download_source() {
    section "Obtendo o Velix"

    if [ -n "$REPO_DIR" ]; then
        if [ ! -d "$REPO_DIR" ]; then
            fatal "REPO_DIR não encontrado: ${REPO_DIR}"
        fi

        mkdir -p "$INSTALL_DIR"

        rsync -a \
            --exclude='.git' \
            --exclude='.env' \
            --exclude='docker-compose.override.yml' \
            "${REPO_DIR}/" \
            "${INSTALL_DIR}/"

        success "Código copiado de ${REPO_DIR}"

    elif [ -d "${INSTALL_DIR}/.git" ]; then
        info "Instalação existente encontrada. Atualizando."

        git -C "$INSTALL_DIR" fetch --all --prune
        git -C "$INSTALL_DIR" pull --ff-only

        success "Velix atualizado"

    elif [ -e "$INSTALL_DIR" ] &&
         [ "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l)" -gt 0 ]; then

        fatal "O diretório ${INSTALL_DIR} já existe e não é um repositório Git."

    else
        git clone "$REPO_URL" "$INSTALL_DIR"
        success "Repositório clonado"
    fi

    cd "$INSTALL_DIR"

    if [ ! -f docker-compose.yml ]; then
        fatal "docker-compose.yml não encontrado em ${INSTALL_DIR}."
    fi

    if [ ! -f apps/api/Dockerfile ]; then
        fatal "Dockerfile da API não encontrado em apps/api/Dockerfile."
    fi

    if [ ! -f apps/web/Dockerfile ]; then
        fatal "Dockerfile do frontend não encontrado em apps/web/Dockerfile."
    fi
}

# ============================================================
# MANIPULAÇÃO DO .ENV
# ============================================================

get_env_value() {
    local key="$1"
    local file="$2"

    grep -E "^${key}=" "$file" 2>/dev/null |
        head -n1 |
        cut -d= -f2- ||
        true
}

upsert_env() {
    local key="$1"
    local value="$2"
    local file="$3"

    if grep -qE "^${key}=" "$file" 2>/dev/null; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$file"
    else
        printf '%s=%s\n' "$key" "$value" >>"$file"
    fi
}

generate_environment() {
    section "Gerando configurações seguras"

    local postgres_password=""
    local jwt_secret=""
    local credential_secret=""

    if [ -f "$ENV_FILE" ]; then
        local backup_file

        backup_file="${ENV_FILE}.backup.$(date +%Y%m%d-%H%M%S)"

        cp "$ENV_FILE" "$backup_file"

        postgres_password="$(get_env_value POSTGRES_PASSWORD "$ENV_FILE")"
        jwt_secret="$(get_env_value JWT_SECRET "$ENV_FILE")"
        credential_secret="$(get_env_value VELIX_CREDENTIAL_SECRET "$ENV_FILE")"

        warning "Arquivo .env existente detectado."
        success "Backup criado em ${backup_file}"
    else
        touch "$ENV_FILE"
    fi

    postgres_password="${postgres_password:-$(openssl rand -hex 32)}"
    jwt_secret="${jwt_secret:-$(openssl rand -hex 48)}"
    credential_secret="${credential_secret:-$(openssl rand -hex 48)}"

    upsert_env \
        "POSTGRES_PASSWORD" \
        "$postgres_password" \
        "$ENV_FILE"

    upsert_env \
        "JWT_SECRET" \
        "$jwt_secret" \
        "$ENV_FILE"

    upsert_env \
        "VELIX_CREDENTIAL_SECRET" \
        "$credential_secret" \
        "$ENV_FILE"

    upsert_env \
        "WEB_ORIGIN" \
        "$WEB_ORIGIN" \
        "$ENV_FILE"

    upsert_env \
        "VELIX_ADMIN_EMAIL" \
        "$ADMIN_EMAIL" \
        "$ENV_FILE"

    upsert_env \
        "VELIX_ADMIN_PASSWORD" \
        "$ADMIN_PASSWORD" \
        "$ENV_FILE"

    upsert_env \
        "VELIX_DOMAIN" \
        "$VELIX_DOMAIN" \
        "$ENV_FILE"

    upsert_env \
        "VELIX_HTTP_PORT" \
        "$PANEL_PORT" \
        "$ENV_FILE"

    upsert_env \
        "TRAEFIK_ACME_EMAIL" \
        "$ACME_EMAIL" \
        "$ENV_FILE"

    upsert_env \
        "NEXT_PUBLIC_APP_URL" \
        "$WEB_ORIGIN" \
        "$ENV_FILE"

    chmod 600 "$ENV_FILE"

    success "Arquivo ${ENV_FILE} configurado"
}

# ============================================================
# OVERRIDE DOCKER COMPOSE
# ============================================================

generate_compose_override() {
    section "Configurando acesso ao painel"

    if [ "$USE_DOMAIN" = "true" ]; then
        cat >"$OVERRIDE_FILE" <<'YAML'
services:
  web:
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=velix_proxy"

      - "traefik.http.routers.velix-http.rule=Host(`${VELIX_DOMAIN}`)"
      - "traefik.http.routers.velix-http.entrypoints=web"
      - "traefik.http.routers.velix-http.middlewares=velix-force-https"

      - "traefik.http.middlewares.velix-force-https.redirectscheme.scheme=https"
      - "traefik.http.middlewares.velix-force-https.redirectscheme.permanent=true"

      - "traefik.http.routers.velix.rule=Host(`${VELIX_DOMAIN}`)"
      - "traefik.http.routers.velix.entrypoints=websecure"
      - "traefik.http.routers.velix.tls=true"
      - "traefik.http.routers.velix.tls.certresolver=letsencrypt"

      - "traefik.http.services.velix.loadbalancer.server.port=3000"

  traefik:
    image: traefik:v3.3
    container_name: velix-traefik
    restart: unless-stopped

    command:
      - "--api.dashboard=false"
      - "--api.insecure=false"

      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"

      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"

      - "--certificatesresolvers.letsencrypt.acme.email=${TRAEFIK_ACME_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"

      - "--ping=true"
      - "--log.level=INFO"
      - "--accesslog=true"

    ports:
      - "80:80"
      - "443:443"

    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - velix_letsencrypt:/letsencrypt

    networks:
      - velix_proxy

    healthcheck:
      test: ["CMD", "traefik", "healthcheck", "--ping"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 10s

volumes:
  velix_letsencrypt:
    name: velix_letsencrypt
YAML

        success "Traefik e HTTPS configurados"

    else
        cat >"$OVERRIDE_FILE" <<'YAML'
services:
  web:
    ports:
      - "${VELIX_HTTP_PORT:-3000}:3000"
YAML

        success "Painel configurado na porta ${PANEL_PORT}"
    fi

    chmod 600 "$OVERRIDE_FILE"
}

# ============================================================
# DNS
# ============================================================

check_dns() {
    if [ "$USE_DOMAIN" != "true" ]; then
        return
    fi

    section "Verificando DNS"

    local resolved_ip=""

    resolved_ip="$(
        dig +short A "$VELIX_DOMAIN" 2>/dev/null |
        tail -n1 ||
        true
    )"

    if [ -z "$resolved_ip" ]; then
        warning "O domínio ${VELIX_DOMAIN} ainda não possui registro A."

        echo
        echo "Crie o seguinte registro DNS:"
        echo
        echo "  Tipo: A"
        echo "  Nome: ${VELIX_DOMAIN}"
        echo "  IP:   ${SERVER_IP}"
        echo

        warning "O Velix será instalado, mas o SSL ficará pendente."
        warning "Após corrigir o DNS, o Traefik emitirá o certificado automaticamente."

        if ! ask_yes_no "Deseja continuar mesmo assim?" "s"; then
            fatal "Instalação cancelada para correção do DNS."
        fi

        return
    fi

    if [ "$resolved_ip" = "$SERVER_IP" ]; then
        success "${VELIX_DOMAIN} aponta corretamente para ${SERVER_IP}"
    else
        warning "O domínio aponta atualmente para: ${resolved_ip}"
        warning "O IP detectado deste servidor é: ${SERVER_IP}"
        warning "O certificado pode não ser emitido até o DNS ser corrigido."

        if ! ask_yes_no "Deseja continuar mesmo assim?" "s"; then
            fatal "Instalação cancelada para correção do DNS."
        fi
    fi
}

# ============================================================
# FIREWALL
# ============================================================

configure_firewall() {
    section "Configurando firewall"

    if ! command -v ufw >/dev/null 2>&1; then
        warning "UFW não encontrado. Nenhuma regra foi alterada."
        return
    fi

    if ! ufw status | grep -q "Status: active"; then
        warning "UFW está inativo. Nenhuma regra foi alterada."
        return
    fi

    ufw allow OpenSSH >/dev/null

    if [ "$USE_DOMAIN" = "true" ]; then
        ufw allow 80/tcp >/dev/null
        ufw allow 443/tcp >/dev/null

        success "Portas 80 e 443 liberadas"
    else
        ufw allow "${PANEL_PORT}/tcp" >/dev/null

        success "Porta ${PANEL_PORT} liberada"
    fi
}

# ============================================================
# SYSTEMD
# ============================================================

create_systemd_service() {
    section "Criando serviço automático"

    cat >"$SYSTEMD_FILE" <<EOF
[Unit]
Description=Velix Infrastructure Platform
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${INSTALL_DIR}

ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecReload=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose stop

TimeoutStartSec=0
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable velix.service

    success "Serviço velix.service criado"
}

# ============================================================
# DEPLOY
# ============================================================

deploy_velix() {
    section "Construindo e iniciando o Velix"

    cd "$INSTALL_DIR"

    info "Validando Docker Compose"

    docker compose config >/dev/null

    success "Configuração do Docker Compose válida"

    info "Construindo imagens"
    warning "A primeira compilação pode levar alguns minutos."

    docker compose build

    info "Iniciando containers"

    docker compose up -d --remove-orphans

    success "Containers iniciados"
}

# ============================================================
# VERIFICAÇÃO
# ============================================================

wait_for_velix() {
    section "Aguardando o Velix"

    local check_url=""

    if [ "$USE_DOMAIN" = "true" ]; then
        check_url="https://${VELIX_DOMAIN}"
    else
        check_url="http://127.0.0.1:${PANEL_PORT}"
    fi

    local attempt

    for attempt in $(seq 1 80); do
        if curl -kfsS \
            --max-time 5 \
            "$check_url" \
            >/dev/null 2>&1; then

            success "O painel respondeu corretamente"
            return
        fi

        printf '.'
        sleep 3
    done

    echo
    warning "Os containers estão ativos, mas o painel ainda não respondeu."
    warning "Verifique os logs com:"
    echo
    echo "  cd ${INSTALL_DIR}"
    echo "  docker compose logs -f"
}

# ============================================================
# RESULTADO
# ============================================================

show_result() {
    section "Instalação concluída"

    echo -e "${GREEN}${BOLD}"
    echo "✔ Velix instalado com sucesso"
    echo -e "${NC}"

    echo "URL:             ${WEB_ORIGIN}"
    echo "Administrador:   ${ADMIN_EMAIL}"
    echo "Senha:           ${ADMIN_PASSWORD}"
    echo
    echo "Diretório:       ${INSTALL_DIR}"
    echo "Configurações:   ${ENV_FILE}"
    echo "Override:        ${OVERRIDE_FILE}"

    if [ "$USE_DOMAIN" = "true" ]; then
        echo "Proxy:           Traefik"
        echo "SSL:             Let's Encrypt"
    else
        echo "Porta:           ${PANEL_PORT}"
    fi

    echo
    echo -e "${BOLD}Comandos úteis${NC}"
    echo
    echo "Status:"
    echo "  cd ${INSTALL_DIR} && docker compose ps"
    echo
    echo "Logs:"
    echo "  cd ${INSTALL_DIR} && docker compose logs -f"
    echo
    echo "Reiniciar:"
    echo "  systemctl restart velix"
    echo
    echo "Parar:"
    echo "  systemctl stop velix"
    echo
    echo "Atualizar:"
    echo "  cd ${INSTALL_DIR}"
    echo "  git pull"
    echo "  docker compose up -d --build --remove-orphans"
    echo

    warning "Guarde a senha do administrador em um local seguro."
    warning "O arquivo .env contém informações sigilosas."
}

# ============================================================
# EXECUÇÃO
# ============================================================

main() {
    show_banner
    require_root
    validate_os

    install_dependencies
    detect_public_ip
    collect_configuration
    install_docker
    download_source
    generate_environment
    generate_compose_override
    check_dns
    configure_firewall
    create_systemd_service
    deploy_velix
    wait_for_velix
    show_result
}

main "$@"
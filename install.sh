#!/usr/bin/env bash

# ============================================================
# Velix Installer
#
# Execução recomendada para repositório privado:
#
#   git clone https://github.com/Jhonata-php/velix.git
#   cd velix
#   chmod +x install.sh
#   sudo ./install.sh
#
# Logs completos:
#
#   tail -f /var/log/velix-install.log
# ============================================================

set -Eeuo pipefail

# ============================================================
# CONFIGURAÇÕES GERAIS
# ============================================================

VELIX_VERSION="1.0.0"

INSTALL_DIR="${INSTALL_DIR:-/opt/velix}"
REPO_URL="${REPO_URL:-https://github.com/Jhonata-php/velix.git}"

SCRIPT_DIR="$(
    cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
    pwd
)"

LOG_FILE="/var/log/velix-install.log"
SYSTEMD_FILE="/etc/systemd/system/velix.service"

ENV_FILE=""
OVERRIDE_FILE=""

DEFAULT_PANEL_PORT="3000"
DEFAULT_ADMIN_EMAIL="admin@velix.local"

SERVER_IP=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
GENERATED_ADMIN_PASSWORD="false"

USE_DOMAIN="false"
VELIX_DOMAIN=""
ACME_EMAIL=""
PANEL_PORT="$DEFAULT_PANEL_PORT"
WEB_ORIGIN=""

SPINNER_PID=""

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
WHITE='\033[0;97m'
BOLD='\033[1m'
NC='\033[0m'

# ============================================================
# LOG
# ============================================================

prepare_log() {
    mkdir -p "$(dirname "$LOG_FILE")"
    touch "$LOG_FILE"
    chmod 600 "$LOG_FILE"

    {
        echo
        echo "============================================================"
        echo "Velix Installer ${VELIX_VERSION}"
        echo "Iniciado em: $(date '+%Y-%m-%d %H:%M:%S')"
        echo "Sistema: $(uname -a)"
        echo "============================================================"
    } >>"$LOG_FILE"
}

log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >>"$LOG_FILE"
}

# ============================================================
# MENSAGENS
# ============================================================

info() {
    echo -e "${BLUE}●${NC} $*"
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
    echo -e "${BOLD}${WHITE}$*${NC}"
    echo -e "${PURPLE}────────────────────────────────────────────────────────────${NC}"
    echo
}

# ============================================================
# SPINNER E EXECUÇÃO SILENCIOSA
# ============================================================

start_spinner() {
    local message="$1"

    printf "  %-49s" "$message"

    (
        local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
        local index=0

        while true; do
            printf "\b${PURPLE}%s${NC}" "${frames[$index]}"
            index=$(( (index + 1) % ${#frames[@]} ))
            sleep 0.1
        done
    ) &

    SPINNER_PID=$!
}

stop_spinner() {
    local status="$1"

    if [ -n "${SPINNER_PID:-}" ]; then
        kill "$SPINNER_PID" >/dev/null 2>&1 || true
        wait "$SPINNER_PID" >/dev/null 2>&1 || true
        SPINNER_PID=""
    fi

    printf "\b"

    if [ "$status" -eq 0 ]; then
        echo -e "${GREEN}✔${NC}"
    else
        echo -e "${RED}✖${NC}"
    fi
}

run_step() {
    local message="$1"
    shift

    local status=0

    log_message "INÍCIO: ${message}"
    log_message "COMANDO: $*"

    start_spinner "$message"

    set +e
    "$@" >>"$LOG_FILE" 2>&1
    status=$?
    set -e

    stop_spinner "$status"

    if [ "$status" -ne 0 ]; then
        error "Falha na etapa: ${message}"
        echo
        echo -e "${GRAY}Últimas linhas do log:${NC}"
        echo
        tail -n 30 "$LOG_FILE" || true
        echo
        error "Log completo: ${LOG_FILE}"
        return "$status"
    fi

    log_message "SUCESSO: ${message}"
}

run_shell_step() {
    local message="$1"
    local command="$2"

    local status=0

    log_message "INÍCIO: ${message}"
    log_message "COMANDO SHELL: ${command}"

    start_spinner "$message"

    set +e
    bash -o pipefail -c "$command" >>"$LOG_FILE" 2>&1
    status=$?
    set -e

    stop_spinner "$status"

    if [ "$status" -ne 0 ]; then
        error "Falha na etapa: ${message}"
        echo
        echo -e "${GRAY}Últimas linhas do log:${NC}"
        echo
        tail -n 30 "$LOG_FILE" || true
        echo
        error "Log completo: ${LOG_FILE}"
        return "$status"
    fi

    log_message "SUCESSO: ${message}"
}

# ============================================================
# TRATAMENTO DE ERROS
# ============================================================

cleanup_spinner() {
    if [ -n "${SPINNER_PID:-}" ]; then
        kill "$SPINNER_PID" >/dev/null 2>&1 || true
        wait "$SPINNER_PID" >/dev/null 2>&1 || true
        SPINNER_PID=""
    fi
}

on_error() {
    local exit_code=$?
    local line_number="${1:-desconhecida}"

    cleanup_spinner

    echo
    error "A instalação do Velix não foi concluída."
    error "Linha aproximada: ${line_number}"
    error "Código de saída: ${exit_code}"
    echo
    echo "Consulte o log completo:"
    echo
    echo "  tail -n 100 ${LOG_FILE}"
    echo

    if command -v docker >/dev/null 2>&1; then
        docker ps -a \
            --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' \
            2>/dev/null || true
    fi

    exit "$exit_code"
}

trap 'on_error $LINENO' ERR
trap cleanup_spinner EXIT INT TERM

# ============================================================
# PERGUNTAS
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

    read -r -s \
        -p "$(echo -e "${CYAN}?${NC} ${prompt}: ")" \
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
        read -r \
            -p "$(echo -e "${CYAN}?${NC} ${prompt} [S/n]: ")" \
            answer </dev/tty

        answer="${answer:-s}"
    else
        read -r \
            -p "$(echo -e "${CYAN}?${NC} ${prompt} [s/N]: ")" \
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
EOF

    echo -e "${NC}"
    echo -e "${PURPLE}${BOLD}Plataforma de infraestrutura, aplicações e automação${NC}"
    echo
    echo -e "${GRAY}Instalador oficial do Velix ${VELIX_VERSION}${NC}"
    echo
}

# ============================================================
# VALIDAÇÕES
# ============================================================

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        fatal "Execute o instalador como root ou utilizando sudo."
    fi
}

detect_system() {
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
            warning "O instalador foi desenvolvido para Ubuntu e Debian."
            ;;
    esac
}

validate_email() {
    local email="$1"

    if [[ ! "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
        return 1
    fi
}

validate_domain() {
    local domain="$1"

    if [[ ! "$domain" =~ ^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$ ]]; then
        return 1
    fi
}

validate_port() {
    local port="$1"

    if ! [[ "$port" =~ ^[0-9]+$ ]]; then
        return 1
    fi

    if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
        return 1
    fi
}

validate_password() {
    local password="$1"

    [ "${#password}" -ge 8 ]
}

# ============================================================
# REQUISITOS DE HARDWARE
# ============================================================

check_hardware() {
    section "Verificando servidor"

    local memory_mb
    local cpu_count
    local disk_available_mb

    memory_mb="$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)"
    cpu_count="$(nproc)"
    disk_available_mb="$(df -Pm / | awk 'NR==2 {print $4}')"

    echo "  CPU:             ${cpu_count} núcleo(s)"
    echo "  Memória:         ${memory_mb} MB"
    echo "  Disco livre:     ${disk_available_mb} MB"
    echo

    if [ "$memory_mb" -lt 1800 ]; then
        warning "Recomendado pelo menos 2 GB de memória RAM."
    fi

    if [ "$disk_available_mb" -lt 5000 ]; then
        warning "Recomendado pelo menos 5 GB de espaço livre."
    fi
}

# ============================================================
# DEPENDÊNCIAS
# ============================================================

install_dependencies() {
    section "Preparando o servidor"

    export DEBIAN_FRONTEND=noninteractive

    run_step \
        "Atualizando lista de pacotes" \
        apt-get update -y

    run_step \
        "Instalando dependências" \
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
}

# ============================================================
# IP DO SERVIDOR
# ============================================================

detect_public_ip() {
    section "Detectando rede"

    start_spinner "Detectando endereço IP público"

    set +e

    SERVER_IP="$(
        curl -4 -fsSL \
            --connect-timeout 8 \
            https://api.ipify.org 2>>"$LOG_FILE"
    )"

    if [ -z "$SERVER_IP" ]; then
        SERVER_IP="$(
            curl -4 -fsSL \
                --connect-timeout 8 \
                https://ifconfig.me 2>>"$LOG_FILE"
        )"
    fi

    if [ -z "$SERVER_IP" ]; then
        SERVER_IP="$(
            hostname -I 2>/dev/null |
            awk '{print $1}'
        )"
    fi

    set -e

    if [ -n "$SERVER_IP" ]; then
        stop_spinner 0
        success "Endereço detectado: ${SERVER_IP}"
    else
        stop_spinner 1
        SERVER_IP="127.0.0.1"
        warning "Não foi possível detectar o IP automaticamente."
    fi
}

# ============================================================
# CONFIGURAÇÃO INTERATIVA
# ============================================================

collect_configuration() {
    section "Configuração inicial"

    INSTALL_DIR="$(ask \
        "Diretório de instalação" \
        "$INSTALL_DIR")"

    ENV_FILE="${INSTALL_DIR}/.env"
    OVERRIDE_FILE="${INSTALL_DIR}/docker-compose.override.yml"

    while true; do
        ADMIN_EMAIL="$(ask \
            "E-mail do administrador" \
            "$DEFAULT_ADMIN_EMAIL")"

        if validate_email "$ADMIN_EMAIL"; then
            break
        fi

        warning "Informe um endereço de e-mail válido."
    done

    while true; do
        ADMIN_PASSWORD="$(ask_secret \
            "Senha do administrador, deixe vazio para gerar")"

        if [ -z "$ADMIN_PASSWORD" ]; then
            ADMIN_PASSWORD="$(
                openssl rand -base64 48 |
                tr -d '/+=' |
                cut -c1-20
            )"

            GENERATED_ADMIN_PASSWORD="true"
            break
        fi

        if validate_password "$ADMIN_PASSWORD"; then
            break
        fi

        warning "A senha precisa ter pelo menos 8 caracteres."
    done

    if ask_yes_no \
        "Deseja configurar um domínio com SSL automático?" \
        "s"; then

        USE_DOMAIN="true"

        while true; do
            VELIX_DOMAIN="$(ask \
                "Domínio do painel, sem http ou https" \
                "")"

            VELIX_DOMAIN="$(
                echo "$VELIX_DOMAIN" |
                tr '[:upper:]' '[:lower:]' |
                sed -E 's#^https?://##; s#/$##'
            )"

            if validate_domain "$VELIX_DOMAIN"; then
                break
            fi

            warning "Domínio inválido. Exemplo: velix.needbr.com"
        done

        while true; do
            ACME_EMAIL="$(ask \
                "E-mail para o certificado SSL" \
                "$ADMIN_EMAIL")"

            if validate_email "$ACME_EMAIL"; then
                break
            fi

            warning "Informe um endereço de e-mail válido."
        done

        WEB_ORIGIN="https://${VELIX_DOMAIN}"
        PANEL_PORT="3000"
    else
        USE_DOMAIN="false"

        while true; do
            PANEL_PORT="$(ask \
                "Porta de acesso ao painel" \
                "$DEFAULT_PANEL_PORT")"

            if validate_port "$PANEL_PORT"; then
                break
            fi

            warning "Informe uma porta entre 1 e 65535."
        done

        WEB_ORIGIN="http://${SERVER_IP}:${PANEL_PORT}"
        VELIX_DOMAIN=""
        ACME_EMAIL=""
    fi

    section "Resumo"

    echo "  Diretório:       ${INSTALL_DIR}"
    echo "  Servidor:        ${SERVER_IP}"
    echo "  Administrador:   ${ADMIN_EMAIL}"
    echo "  URL:             ${WEB_ORIGIN}"

    if [ "$USE_DOMAIN" = "true" ]; then
        echo "  Proxy:           Traefik"
        echo "  SSL:             Let's Encrypt"
    else
        echo "  Porta:           ${PANEL_PORT}"
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
    section "Configurando Docker"

    if command -v docker >/dev/null 2>&1 &&
       docker compose version >/dev/null 2>&1; then

        success "Docker já está instalado"
        success "$(docker compose version)"
        return
    fi

    run_step \
        "Preparando repositório do Docker" \
        install -m 0755 -d /etc/apt/keyrings

    local os_id
    local codename

    # shellcheck disable=SC1091
    source /etc/os-release

    os_id="${ID}"

    if [ "$os_id" = "debian" ]; then
        run_shell_step \
            "Importando chave do Docker" \
            "curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc"

        codename="${VERSION_CODENAME}"

        echo \
            "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${codename} stable" \
            > /etc/apt/sources.list.d/docker.list
    else
        run_shell_step \
            "Importando chave do Docker" \
            "curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc"

        codename="${VERSION_CODENAME}"

        echo \
            "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable" \
            > /etc/apt/sources.list.d/docker.list
    fi

    chmod a+r /etc/apt/keyrings/docker.asc

    run_step \
        "Atualizando repositórios do Docker" \
        apt-get update -y

    run_step \
        "Instalando Docker Engine" \
        apt-get install -y \
            docker-ce \
            docker-ce-cli \
            containerd.io \
            docker-buildx-plugin \
            docker-compose-plugin

    run_step \
        "Ativando serviço Docker" \
        systemctl enable --now docker

    docker compose version >/dev/null 2>&1 ||
        fatal "Docker Compose não foi instalado corretamente."

    success "$(docker --version)"
    success "$(docker compose version)"
}

# ============================================================
# ARQUIVOS DO VELIX
# ============================================================

is_velix_source_directory() {
    local directory="$1"

    [ -f "${directory}/docker-compose.yml" ] &&
    [ -d "${directory}/apps/api" ] &&
    [ -d "${directory}/apps/web" ]
}

copy_local_source() {
    mkdir -p "$INSTALL_DIR"

    run_step \
        "Copiando arquivos do Velix" \
        rsync -a \
            --delete \
            --exclude='.git/' \
            --exclude='.env' \
            --exclude='docker-compose.override.yml' \
            --exclude='node_modules/' \
            --exclude='.next/' \
            --exclude='dist/' \
            "${SCRIPT_DIR}/" \
            "${INSTALL_DIR}/"
}

update_existing_repository() {
    run_step \
        "Atualizando repositório existente" \
        git -C "$INSTALL_DIR" pull --ff-only
}

clone_repository() {
    run_step \
        "Baixando repositório do Velix" \
        git clone "$REPO_URL" "$INSTALL_DIR"
}

prepare_source() {
    section "Preparando arquivos do Velix"

    if [ "$SCRIPT_DIR" = "$INSTALL_DIR" ]; then
        success "Instalador executado no diretório final"
    elif is_velix_source_directory "$SCRIPT_DIR"; then
        copy_local_source
    elif [ -d "${INSTALL_DIR}/.git" ]; then
        update_existing_repository
    elif is_velix_source_directory "$INSTALL_DIR"; then
        success "Instalação existente encontrada em ${INSTALL_DIR}"
    elif [ -e "$INSTALL_DIR" ] &&
         [ "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l)" -gt 0 ]; then

        fatal "O diretório ${INSTALL_DIR} não está vazio."
    else
        clone_repository
    fi

    if ! is_velix_source_directory "$INSTALL_DIR"; then
        fatal "Os arquivos necessários do Velix não foram encontrados."
    fi

    ENV_FILE="${INSTALL_DIR}/.env"
    OVERRIDE_FILE="${INSTALL_DIR}/docker-compose.override.yml"

    success "Arquivos preparados em ${INSTALL_DIR}"
}

# ============================================================
# .ENV
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
    section "Gerando configurações"

    local postgres_password=""
    local jwt_secret=""
    local credential_secret=""

    if [ -f "$ENV_FILE" ]; then
        local backup_file

        backup_file="${ENV_FILE}.backup.$(date +%Y%m%d-%H%M%S)"

        cp "$ENV_FILE" "$backup_file"

        postgres_password="$(
            get_env_value POSTGRES_PASSWORD "$ENV_FILE"
        )"

        jwt_secret="$(
            get_env_value JWT_SECRET "$ENV_FILE"
        )"

        credential_secret="$(
            get_env_value VELIX_CREDENTIAL_SECRET "$ENV_FILE"
        )"

        warning "Configuração anterior encontrada"
        success "Backup criado em ${backup_file}"
    else
        touch "$ENV_FILE"
    fi

    postgres_password="${
        postgres_password:-$(openssl rand -hex 32)
    }"

    jwt_secret="${
        jwt_secret:-$(openssl rand -hex 48)
    }"

    credential_secret="${
        credential_secret:-$(openssl rand -hex 48)
    }"

    upsert_env \
        POSTGRES_PASSWORD \
        "$postgres_password" \
        "$ENV_FILE"

    upsert_env \
        JWT_SECRET \
        "$jwt_secret" \
        "$ENV_FILE"

    upsert_env \
        VELIX_CREDENTIAL_SECRET \
        "$credential_secret" \
        "$ENV_FILE"

    upsert_env \
        WEB_ORIGIN \
        "$WEB_ORIGIN" \
        "$ENV_FILE"

    upsert_env \
        NEXT_PUBLIC_APP_URL \
        "$WEB_ORIGIN" \
        "$ENV_FILE"

    upsert_env \
        VELIX_ADMIN_EMAIL \
        "$ADMIN_EMAIL" \
        "$ENV_FILE"

    upsert_env \
        VELIX_ADMIN_PASSWORD \
        "$ADMIN_PASSWORD" \
        "$ENV_FILE"

    upsert_env \
        VELIX_DOMAIN \
        "$VELIX_DOMAIN" \
        "$ENV_FILE"

    upsert_env \
        VELIX_HTTP_PORT \
        "$PANEL_PORT" \
        "$ENV_FILE"

    upsert_env \
        TRAEFIK_ACME_EMAIL \
        "$ACME_EMAIL" \
        "$ENV_FILE"

    chmod 600 "$ENV_FILE"
    chown root:root "$ENV_FILE"

    success "Variáveis e segredos gerados"
}

# ============================================================
# DOCKER COMPOSE OVERRIDE
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
    chown root:root "$OVERRIDE_FILE"
}

# ============================================================
# DNS
# ============================================================

check_dns() {
    if [ "$USE_DOMAIN" != "true" ]; then
        return
    fi

    section "Verificando domínio"

    local resolved_ips=""
    local dns_ok="false"

    resolved_ips="$(
        dig +short A "$VELIX_DOMAIN" 2>/dev/null |
        grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' ||
        true
    )"

    if echo "$resolved_ips" | grep -qx "$SERVER_IP"; then
        dns_ok="true"
    fi

    if [ "$dns_ok" = "true" ]; then
        success "${VELIX_DOMAIN} aponta para ${SERVER_IP}"
        return
    fi

    warning "O domínio ainda não aponta para o IP detectado."

    echo
    echo "Configure o seguinte registro DNS:"
    echo
    echo "  Tipo: A"
    echo "  Nome: ${VELIX_DOMAIN}"
    echo "  IP:   ${SERVER_IP}"
    echo

    if [ -n "$resolved_ips" ]; then
        echo "IP encontrado atualmente:"
        echo "$resolved_ips" | sed 's/^/  /'
        echo
    fi

    warning "O Velix poderá iniciar, mas o certificado ficará pendente."

    if ! ask_yes_no "Deseja continuar mesmo assim?" "s"; then
        fatal "Instalação cancelada para correção do DNS."
    fi
}

# ============================================================
# PORTAS
# ============================================================

check_required_ports() {
    section "Verificando portas"

    local ports=()

    if [ "$USE_DOMAIN" = "true" ]; then
        ports=(80 443)
    else
        ports=("$PANEL_PORT")
    fi

    local port

    for port in "${ports[@]}"; do
        if ss -lnt 2>/dev/null |
           awk '{print $4}' |
           grep -Eq ":${port}$"; then

            warning "A porta ${port} já está sendo utilizada."

            if ! ask_yes_no \
                "Deseja continuar mesmo com a porta ${port} ocupada?" \
                "n"; then

                fatal "Libere a porta ${port} antes de continuar."
            fi
        else
            success "Porta ${port} disponível"
        fi
    done
}

# ============================================================
# FIREWALL
# ============================================================

configure_firewall() {
    section "Configurando firewall"

    if ! command -v ufw >/dev/null 2>&1; then
        warning "UFW não encontrado"
        return
    fi

    if ! ufw status | grep -q "Status: active"; then
        warning "UFW está inativo; nenhuma regra foi modificada"
        return
    fi

    run_step \
        "Mantendo acesso SSH liberado" \
        ufw allow OpenSSH

    if [ "$USE_DOMAIN" = "true" ]; then
        run_step \
            "Liberando porta HTTP" \
            ufw allow 80/tcp

        run_step \
            "Liberando porta HTTPS" \
            ufw allow 443/tcp
    else
        run_step \
            "Liberando porta ${PANEL_PORT}" \
            ufw allow "${PANEL_PORT}/tcp"
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
TimeoutStopSec=180

[Install]
WantedBy=multi-user.target
EOF

    run_step \
        "Atualizando serviços do sistema" \
        systemctl daemon-reload

    run_step \
        "Ativando inicialização automática" \
        systemctl enable velix.service
}

# ============================================================
# DEPLOY
# ============================================================

deploy_velix() {
    section "Instalando o Velix"

    cd "$INSTALL_DIR"

    run_step \
        "Validando Docker Compose" \
        docker compose config

    run_step \
        "Baixando imagens externas" \
        docker compose pull \
            --ignore-buildable

    run_step \
        "Construindo aplicação" \
        docker compose build

    run_step \
        "Iniciando containers" \
        docker compose up -d \
            --remove-orphans

    run_step \
        "Atualizando serviço Velix" \
        systemctl restart velix.service
}

# ============================================================
# VERIFICAÇÃO DOS CONTAINERS
# ============================================================

wait_for_containers() {
    section "Verificando serviços"

    local attempt
    local postgres_status=""
    local api_status=""
    local web_status=""

    for attempt in $(seq 1 60); do
        postgres_status="$(
            docker inspect \
                -f '{{.State.Status}}' \
                velix-postgres 2>/dev/null ||
            true
        )"

        api_status="$(
            docker inspect \
                -f '{{.State.Status}}' \
                velix-api 2>/dev/null ||
            true
        )"

        web_status="$(
            docker inspect \
                -f '{{.State.Status}}' \
                velix-web 2>/dev/null ||
            true
        )"

        if [ "$postgres_status" = "running" ] &&
           [ "$api_status" = "running" ] &&
           [ "$web_status" = "running" ]; then

            success "Banco de dados em execução"
            success "API em execução"
            success "Painel web em execução"
            return
        fi

        sleep 3
    done

    warning "Algum serviço ainda não está em execução."

    docker compose ps || true

    echo
    warning "Verifique os logs:"
    echo
    echo "  cd ${INSTALL_DIR}"
    echo "  docker compose logs --tail=200"
}

# ============================================================
# VERIFICAÇÃO HTTP
# ============================================================

wait_for_panel() {
    section "Testando painel"

    local check_url=""
    local attempt
    local status=1

    if [ "$USE_DOMAIN" = "true" ]; then
        check_url="https://${VELIX_DOMAIN}"
    else
        check_url="http://127.0.0.1:${PANEL_PORT}"
    fi

    start_spinner "Aguardando resposta do painel"

    set +e

    for attempt in $(seq 1 80); do
        curl -kfsS \
            --max-time 5 \
            "$check_url" \
            >/dev/null 2>>"$LOG_FILE"

        status=$?

        if [ "$status" -eq 0 ]; then
            break
        fi

        sleep 3
    done

    set -e

    stop_spinner "$status"

    if [ "$status" -eq 0 ]; then
        success "O painel respondeu corretamente"
    else
        warning "O painel ainda não respondeu pela URL configurada."
        warning "Os containers podem ainda estar inicializando."

        echo
        echo "Veja os logs com:"
        echo
        echo "  cd ${INSTALL_DIR}"
        echo "  docker compose logs -f"
    fi
}

# ============================================================
# RESULTADO
# ============================================================

show_result() {
    section "Instalação concluída"

    echo -e "${GREEN}${BOLD}"
    echo "  ✔ Velix instalado com sucesso"
    echo -e "${NC}"

    echo "  URL:             ${WEB_ORIGIN}"
    echo "  Administrador:   ${ADMIN_EMAIL}"
    echo "  Senha:           ${ADMIN_PASSWORD}"
    echo
    echo "  Diretório:       ${INSTALL_DIR}"
    echo "  Configuração:    ${ENV_FILE}"
    echo "  Log:             ${LOG_FILE}"

    if [ "$USE_DOMAIN" = "true" ]; then
        echo "  Proxy:           Traefik"
        echo "  SSL:             Let's Encrypt"
    else
        echo "  Porta:           ${PANEL_PORT}"
    fi

    echo
    echo -e "${BOLD}Comandos úteis${NC}"
    echo
    echo "  Ver containers:"
    echo "    cd ${INSTALL_DIR} && docker compose ps"
    echo
    echo "  Acompanhar logs:"
    echo "    cd ${INSTALL_DIR} && docker compose logs -f"
    echo
    echo "  Log do instalador:"
    echo "    tail -f ${LOG_FILE}"
    echo
    echo "  Reiniciar:"
    echo "    systemctl restart velix"
    echo
    echo "  Parar:"
    echo "    systemctl stop velix"
    echo
    echo "  Iniciar:"
    echo "    systemctl start velix"
    echo

    warning "Guarde a senha administrativa em local seguro."
    warning "O arquivo .env contém senhas e segredos do sistema."
}

# ============================================================
# EXECUÇÃO
# ============================================================

main() {
    prepare_log
    show_banner
    require_root
    detect_system
    check_hardware
    install_dependencies
    detect_public_ip
    collect_configuration
    install_docker
    prepare_source
    check_required_ports
    generate_environment
    generate_compose_override
    check_dns
    configure_firewall
    create_systemd_service
    deploy_velix
    wait_for_containers
    wait_for_panel
    show_result
}

main "$@"
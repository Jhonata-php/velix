#!/usr/bin/env bash

# ============================================================
# Velix Installer
#
# Repositório privado:
#   git clone https://github.com/Jhonata-php/velix.git
#   cd velix
#   chmod +x install.sh
#   sudo ./install.sh
#
# Log:
#   tail -f /var/log/velix-install.log
# ============================================================

set -Eeuo pipefail
IFS=$'\n\t'
umask 077

VELIX_VERSION="1.0.1"

INSTALL_DIR="${INSTALL_DIR:-/opt/velix}"
REPO_URL="${REPO_URL:-https://github.com/Jhonata-php/velix.git}"
LOG_FILE="${LOG_FILE:-/var/log/velix-install.log}"
SYSTEMD_FILE="/etc/systemd/system/velix.service"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

DEFAULT_PANEL_PORT="3000"
DEFAULT_ADMIN_EMAIL="admin@velix.local"
MIN_MEMORY_MB="1800"
SWAP_SIZE_GB="${SWAP_SIZE_GB:-4}"

ENV_FILE=""
OVERRIDE_FILE=""

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
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG_FILE"
}

info()    { echo -e "${BLUE}●${NC} $*"; }
success() { echo -e "${GREEN}✔${NC} $*"; }
warning() { echo -e "${YELLOW}⚠${NC} $*"; }
error()   { echo -e "${RED}✖${NC} $*" >&2; }
fatal()   { error "$*"; exit 1; }

section() {
    echo
    echo -e "${PURPLE}────────────────────────────────────────────────────────────${NC}"
    echo -e "${BOLD}${WHITE}$*${NC}"
    echo -e "${PURPLE}────────────────────────────────────────────────────────────${NC}"
    echo
}

start_spinner() {
    local message="$1"
    printf "  %-49s" "$message"

    (
        local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
        local index=0
        while true; do
            printf "\b${PURPLE}%s${NC}" "${frames[$index]}"
            index=$(((index + 1) % ${#frames[@]}))
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
    printf '[%s] COMANDO:' "$(date '+%Y-%m-%d %H:%M:%S')" >>"$LOG_FILE"
    printf ' %q' "$@" >>"$LOG_FILE"
    echo >>"$LOG_FILE"

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
        tail -n 40 "$LOG_FILE" || true
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
        tail -n 40 "$LOG_FILE" || true
        echo
        error "Log completo: ${LOG_FILE}"
        return "$status"
    fi

    log_message "SUCESSO: ${message}"
}

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
    echo "  tail -n 100 ${LOG_FILE}"
    echo

    if command -v docker >/dev/null 2>&1; then
        docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null || true
    fi

    exit "$exit_code"
}

trap 'on_error $LINENO' ERR
trap cleanup_spinner EXIT INT TERM

ask() {
    local prompt="$1"
    local default_value="${2:-}"
    local answer=""

    if [ ! -e /dev/tty ]; then
        echo "$default_value"
        return
    fi

    if [ -n "$default_value" ]; then
        read -r -p "$(echo -e "${CYAN}?${NC} ${prompt} [${default_value}]: ")" answer </dev/tty
        echo "${answer:-$default_value}"
    else
        read -r -p "$(echo -e "${CYAN}?${NC} ${prompt}: ")" answer </dev/tty
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

    read -r -s -p "$(echo -e "${CYAN}?${NC} ${prompt}: ")" answer </dev/tty
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
        read -r -p "$(echo -e "${CYAN}?${NC} ${prompt} [S/n]: ")" answer </dev/tty
        answer="${answer:-s}"
    else
        read -r -p "$(echo -e "${CYAN}?${NC} ${prompt} [s/N]: ")" answer </dev/tty
        answer="${answer:-n}"
    fi

    case "${answer,,}" in
        s|sim|y|yes) return 0 ;;
        *) return 1 ;;
    esac
}

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

require_root() {
    [ "$(id -u)" -eq 0 ] || fatal "Execute o instalador como root ou utilizando sudo."
}

detect_system() {
    [ -f /etc/os-release ] || fatal "Não foi possível identificar o sistema operacional."
    # shellcheck disable=SC1091
    source /etc/os-release

    case "${ID:-}" in
        ubuntu|debian) success "Sistema detectado: ${PRETTY_NAME}" ;;
        *)
            warning "Sistema detectado: ${PRETTY_NAME:-desconhecido}"
            warning "O instalador foi desenvolvido para Ubuntu e Debian."
            ;;
    esac
}

validate_email() {
    [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]
}

validate_domain() {
    [[ "$1" =~ ^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$ ]]
}

validate_port() {
    [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

validate_password() {
    [ "${#1}" -ge 8 ]
}

check_hardware() {
    section "Verificando servidor"

    local memory_mb cpu_count disk_available_mb
    memory_mb="$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)"
    cpu_count="$(nproc)"
    disk_available_mb="$(df -Pm / | awk 'NR==2 {print $4}')"

    echo "  CPU:             ${cpu_count} núcleo(s)"
    echo "  Memória:         ${memory_mb} MB"
    echo "  Disco livre:     ${disk_available_mb} MB"
    echo

    [ "$memory_mb" -ge "$MIN_MEMORY_MB" ] || warning "Recomendado pelo menos 2 GB de memória RAM."
    [ "$disk_available_mb" -ge 5000 ] || warning "Recomendado pelo menos 5 GB de espaço livre."
}

ensure_swap() {
    local memory_mb swap_mb
    memory_mb="$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)"
    swap_mb="$(awk '/SwapTotal/ {print int($2 / 1024)}' /proc/meminfo)"

    if [ "$memory_mb" -ge "$MIN_MEMORY_MB" ] || [ "$swap_mb" -ge 2048 ]; then
        return
    fi

    section "Otimizando memória"

    warning "Pouca RAM detectada. Será criado swap de ${SWAP_SIZE_GB} GB para evitar falhas no build."

    if [ ! -f /swapfile ]; then
        if ! fallocate -l "${SWAP_SIZE_GB}G" /swapfile >>"$LOG_FILE" 2>&1; then
            run_step "Criando arquivo de swap" dd if=/dev/zero of=/swapfile bs=1M count="$((SWAP_SIZE_GB * 1024))" status=none
        fi
    fi

    run_step "Protegendo arquivo de swap" chmod 600 /swapfile

    if ! file /swapfile 2>/dev/null | grep -q 'swap file'; then
        run_step "Formatando swap" mkswap /swapfile
    fi

    if ! swapon --show=NAME --noheadings | grep -qx '/swapfile'; then
        run_step "Ativando swap" swapon /swapfile
    fi

    if ! grep -qE '^/swapfile[[:space:]]' /etc/fstab; then
        echo '/swapfile none swap sw 0 0' >>/etc/fstab
    fi

    sysctl vm.swappiness=20 >>"$LOG_FILE" 2>&1 || true
    cat >/etc/sysctl.d/99-velix-memory.conf <<'EOF'
vm.swappiness=20
vm.vfs_cache_pressure=50
EOF

    success "Swap ativo: $(free -h | awk '/Swap:/ {print $2}')"
}

install_dependencies() {
    section "Preparando o servidor"
    export DEBIAN_FRONTEND=noninteractive

    run_step "Atualizando lista de pacotes" apt-get update -y
    run_step "Instalando dependências" apt-get install -y \
        ca-certificates curl dnsutils git gnupg jq lsb-release openssl \
        rsync ufw iproute2 util-linux
}

detect_public_ip() {
    section "Detectando rede"
    start_spinner "Detectando endereço IP público"

    set +e
    SERVER_IP="$(curl -4 -fsSL --connect-timeout 8 https://api.ipify.org 2>>"$LOG_FILE")"
    [ -n "$SERVER_IP" ] || SERVER_IP="$(curl -4 -fsSL --connect-timeout 8 https://ifconfig.me 2>>"$LOG_FILE")"
    [ -n "$SERVER_IP" ] || SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
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

collect_configuration() {
    section "Configuração inicial"

    INSTALL_DIR="$(ask "Diretório de instalação" "$INSTALL_DIR")"
    ENV_FILE="${INSTALL_DIR}/.env"
    OVERRIDE_FILE="${INSTALL_DIR}/docker-compose.override.yml"

    while true; do
        ADMIN_EMAIL="$(ask "E-mail do administrador" "$DEFAULT_ADMIN_EMAIL")"
        validate_email "$ADMIN_EMAIL" && break
        warning "Informe um endereço de e-mail válido."
    done

    while true; do
        ADMIN_PASSWORD="$(ask_secret "Senha do administrador, deixe vazio para gerar")"

        if [ -z "$ADMIN_PASSWORD" ]; then
            ADMIN_PASSWORD="$(openssl rand -base64 48 | tr -d '/+=' | cut -c1-20)"
            GENERATED_ADMIN_PASSWORD="true"
            break
        fi

        validate_password "$ADMIN_PASSWORD" && break
        warning "A senha precisa ter pelo menos 8 caracteres."
    done

    if ask_yes_no "Deseja configurar um domínio com SSL automático?" "s"; then
        USE_DOMAIN="true"

        while true; do
            VELIX_DOMAIN="$(ask "Domínio do painel, sem http ou https" "")"
            VELIX_DOMAIN="$(echo "$VELIX_DOMAIN" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/$##')"
            validate_domain "$VELIX_DOMAIN" && break
            warning "Domínio inválido. Exemplo: velix.needbr.com"
        done

        while true; do
            ACME_EMAIL="$(ask "E-mail para o certificado SSL" "$ADMIN_EMAIL")"
            validate_email "$ACME_EMAIL" && break
            warning "Informe um endereço de e-mail válido."
        done

        WEB_ORIGIN="https://${VELIX_DOMAIN}"
        PANEL_PORT="3000"
    else
        USE_DOMAIN="false"

        while true; do
            PANEL_PORT="$(ask "Porta de acesso ao painel" "$DEFAULT_PANEL_PORT")"
            validate_port "$PANEL_PORT" && break
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
    ask_yes_no "Confirma a instalação?" "s" || fatal "Instalação cancelada."
}

install_docker() {
    section "Configurando Docker"

    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        success "Docker já está instalado"
        success "$(docker compose version)"
        systemctl enable --now docker >>"$LOG_FILE" 2>&1 || true
        return
    fi

    run_step "Preparando repositório do Docker" install -m 0755 -d /etc/apt/keyrings

    # shellcheck disable=SC1091
    source /etc/os-release
    local os_id="${ID}"
    local codename="${VERSION_CODENAME}"

    run_shell_step "Importando chave do Docker" \
        "curl -fsSL https://download.docker.com/linux/${os_id}/gpg -o /etc/apt/keyrings/docker.asc"

    chmod a+r /etc/apt/keyrings/docker.asc

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${os_id} ${codename} stable" \
        >/etc/apt/sources.list.d/docker.list

    run_step "Atualizando repositórios do Docker" apt-get update -y
    run_step "Instalando Docker Engine" apt-get install -y \
        docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    run_step "Ativando serviço Docker" systemctl enable --now docker

    docker compose version >/dev/null 2>&1 || fatal "Docker Compose não foi instalado corretamente."
    success "$(docker --version)"
    success "$(docker compose version)"
}

is_velix_source_directory() {
    local directory="$1"
    [ -f "${directory}/docker-compose.yml" ] &&
    [ -d "${directory}/apps/api" ] &&
    [ -d "${directory}/apps/web" ]
}

copy_local_source() {
    mkdir -p "$INSTALL_DIR"

    run_step "Copiando arquivos do Velix" rsync -a --delete \
        --exclude='.git/' \
        --exclude='.env' \
        --exclude='.env.backup.*' \
        --exclude='docker-compose.override.yml' \
        --exclude='node_modules/' \
        --exclude='.next/' \
        --exclude='dist/' \
        "${SCRIPT_DIR}/" "${INSTALL_DIR}/"
}

update_existing_repository() {
    run_step "Atualizando repositório existente" git -C "$INSTALL_DIR" pull --ff-only
}

clone_repository() {
    run_step "Baixando repositório do Velix" git clone "$REPO_URL" "$INSTALL_DIR"
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
    elif [ -e "$INSTALL_DIR" ] && [ "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l)" -gt 0 ]; then
        fatal "O diretório ${INSTALL_DIR} não está vazio."
    else
        clone_repository
    fi

    is_velix_source_directory "$INSTALL_DIR" || fatal "Os arquivos necessários do Velix não foram encontrados."

    ENV_FILE="${INSTALL_DIR}/.env"
    OVERRIDE_FILE="${INSTALL_DIR}/docker-compose.override.yml"
    success "Arquivos preparados em ${INSTALL_DIR}"
}

get_env_value() {
    local key="$1"
    local file="$2"
    awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$file" 2>/dev/null || true
}

write_env_file() {
    local postgres_password="$1"
    local jwt_secret="$2"
    local credential_secret="$3"

    cat >"$ENV_FILE" <<EOF
POSTGRES_PASSWORD=${postgres_password}
JWT_SECRET=${jwt_secret}
VELIX_CREDENTIAL_SECRET=${credential_secret}
WEB_ORIGIN=${WEB_ORIGIN}
NEXT_PUBLIC_APP_URL=${WEB_ORIGIN}
VELIX_ADMIN_EMAIL=${ADMIN_EMAIL}
VELIX_ADMIN_PASSWORD=${ADMIN_PASSWORD}
VELIX_DOMAIN=${VELIX_DOMAIN}
VELIX_HTTP_PORT=${PANEL_PORT}
TRAEFIK_ACME_EMAIL=${ACME_EMAIL}
EOF
}

generate_environment() {
    section "Gerando configurações"

    local postgres_password=""
    local jwt_secret=""
    local credential_secret=""

    if [ -f "$ENV_FILE" ]; then
        local backup_file="${ENV_FILE}.backup.$(date +%Y%m%d-%H%M%S)"
        cp "$ENV_FILE" "$backup_file"

        postgres_password="$(get_env_value POSTGRES_PASSWORD "$ENV_FILE")"
        jwt_secret="$(get_env_value JWT_SECRET "$ENV_FILE")"
        credential_secret="$(get_env_value VELIX_CREDENTIAL_SECRET "$ENV_FILE")"

        warning "Configuração anterior encontrada"
        success "Backup criado em ${backup_file}"
    fi

    if [ -z "$postgres_password" ]; then
        postgres_password="$(openssl rand -hex 32)"
    fi

    if [ -z "$jwt_secret" ]; then
        jwt_secret="$(openssl rand -hex 48)"
    fi

    if [ -z "$credential_secret" ]; then
        credential_secret="$(openssl rand -hex 48)"
    fi

    write_env_file "$postgres_password" "$jwt_secret" "$credential_secret"
    chmod 600 "$ENV_FILE"
    chown root:root "$ENV_FILE"

    success "Variáveis e segredos gerados"
}

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

check_dns() {
    [ "$USE_DOMAIN" = "true" ] || return

    section "Verificando domínio"

    local resolved_ips=""
    resolved_ips="$(dig +short A "$VELIX_DOMAIN" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)"

    if echo "$resolved_ips" | grep -qx "$SERVER_IP"; then
        success "${VELIX_DOMAIN} aponta para ${SERVER_IP}"
        return
    fi

    warning "O domínio ainda não aponta para o IP detectado."
    echo
    echo "Configure o seguinte registro DNS:"
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
    ask_yes_no "Deseja continuar mesmo assim?" "s" || fatal "Instalação cancelada para correção do DNS."
}

check_required_ports() {
    section "Verificando portas"

    local ports=()
    [ "$USE_DOMAIN" = "true" ] && ports=(80 443) || ports=("$PANEL_PORT")

    local port
    for port in "${ports[@]}"; do
        if ss -H -lnt "sport = :${port}" 2>/dev/null | grep -q .; then
            warning "A porta ${port} já está sendo utilizada."
            ask_yes_no "Deseja continuar mesmo com a porta ${port} ocupada?" "n" ||
                fatal "Libere a porta ${port} antes de continuar."
        else
            success "Porta ${port} disponível"
        fi
    done
}

configure_firewall() {
    section "Configurando firewall"

    command -v ufw >/dev/null 2>&1 || { warning "UFW não encontrado"; return; }

    if ! ufw status | grep -q "Status: active"; then
        warning "UFW está inativo; nenhuma regra foi modificada"
        return
    fi

    run_step "Mantendo acesso SSH liberado" ufw allow OpenSSH

    if [ "$USE_DOMAIN" = "true" ]; then
        run_step "Liberando porta HTTP" ufw allow 80/tcp
        run_step "Liberando porta HTTPS" ufw allow 443/tcp
    else
        run_step "Liberando porta ${PANEL_PORT}" ufw allow "${PANEL_PORT}/tcp"
    fi
}

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
Environment=COMPOSE_PROJECT_NAME=velix
Environment=COMPOSE_PARALLEL_LIMIT=1
ExecStart=/usr/bin/docker compose --env-file ${ENV_FILE} up -d --remove-orphans
ExecReload=/usr/bin/docker compose --env-file ${ENV_FILE} up -d --remove-orphans
ExecStop=/usr/bin/docker compose --env-file ${ENV_FILE} stop
TimeoutStartSec=0
TimeoutStopSec=180

[Install]
WantedBy=multi-user.target
EOF

    run_step "Atualizando serviços do sistema" systemctl daemon-reload
    run_step "Ativando inicialização automática" systemctl enable velix.service
}

deploy_velix() {
    section "Instalando o Velix"
    cd "$INSTALL_DIR"

    export COMPOSE_PROJECT_NAME=velix
    export COMPOSE_PARALLEL_LIMIT=1
    export DOCKER_BUILDKIT=1

    run_step "Validando Docker Compose" docker compose --env-file "$ENV_FILE" config
    run_step "Baixando imagens externas" docker compose --env-file "$ENV_FILE" pull --ignore-buildable

    # Limita o paralelismo para reduzir consumo de RAM em VMs pequenas.
    run_step "Construindo aplicação" docker compose --env-file "$ENV_FILE" build --pull

    run_step "Iniciando containers" docker compose --env-file "$ENV_FILE" up -d --remove-orphans
    run_step "Atualizando serviço Velix" systemctl restart velix.service
}

container_state() {
    local container="$1"
    docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || true
}

wait_for_containers() {
    section "Verificando serviços"

    local attempt postgres_status api_status web_status

    for attempt in $(seq 1 60); do
        postgres_status="$(container_state velix-postgres)"
        api_status="$(container_state velix-api)"
        web_status="$(container_state velix-web)"

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
    (cd "$INSTALL_DIR" && docker compose --env-file "$ENV_FILE" ps) || true
    echo
    warning "Verifique os logs:"
    echo "  cd ${INSTALL_DIR}"
    echo "  docker compose --env-file .env logs --tail=200"
}

wait_for_panel() {
    section "Testando painel"

    local check_url attempt status=1

    if [ "$USE_DOMAIN" = "true" ]; then
        # Testa localmente pelo Traefik usando o Host correto, sem depender da propagação DNS.
        check_url="https://127.0.0.1"
    else
        check_url="http://127.0.0.1:${PANEL_PORT}"
    fi

    start_spinner "Aguardando resposta do painel"
    set +e

    for attempt in $(seq 1 80); do
        if [ "$USE_DOMAIN" = "true" ]; then
            curl -kfsS --max-time 5 -H "Host: ${VELIX_DOMAIN}" "$check_url" >/dev/null 2>>"$LOG_FILE"
        else
            curl -fsS --max-time 5 "$check_url" >/dev/null 2>>"$LOG_FILE"
        fi

        status=$?
        [ "$status" -eq 0 ] && break
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
        echo "  cd ${INSTALL_DIR}"
        echo "  docker compose --env-file .env logs -f"
    fi
}

show_result() {
    section "Instalação concluída"

    echo -e "${GREEN}${BOLD}  ✔ Velix instalado com sucesso${NC}"
    echo
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
    echo "  cd ${INSTALL_DIR} && docker compose --env-file .env ps"
    echo "  cd ${INSTALL_DIR} && docker compose --env-file .env logs -f"
    echo "  tail -f ${LOG_FILE}"
    echo "  systemctl restart velix"
    echo

    warning "Guarde a senha administrativa em local seguro."
    warning "O arquivo .env contém senhas e segredos do sistema."
}

main() {
    prepare_log
    show_banner
    require_root
    detect_system
    check_hardware
    install_dependencies
    ensure_swap
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

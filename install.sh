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

INSTALL_DIR="${INSTALL_DIR:-/opt/velix}"
REPO_URL="${REPO_URL:-https://github.com/Jhonata-php/velix.git}"
LOG_FILE="${LOG_FILE:-/var/log/velix-install.log}"
SYSTEMD_FILE="/etc/systemd/system/velix.service"
FIREWALL_SCRIPT="/usr/local/sbin/velix-firewall"
SELF_UPDATE_SCRIPT="/usr/local/sbin/velix-self-update"
LOCK_FILE="/var/run/velix-install.lock"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

# Fonte única da versão: apps/api/VERSION (ver VersionService) — nunca
# hardcoded aqui. Se install.sh estiver rodando fora de um checkout do
# repositório (ex.: baixado avulso antes do `git clone`), o arquivo ainda não
# existe localmente; "dev" é só um rótulo de exibição no banner, não afeta
# nada funcional.
VELIX_VERSION="$(cat "${SCRIPT_DIR}/apps/api/VERSION" 2>/dev/null || echo "dev")"

DEFAULT_PANEL_PORT="3000"
DEFAULT_ADMIN_EMAIL="admin@velix.local"
MIN_MEMORY_MB="1800"
SWAP_SIZE_GB="${SWAP_SIZE_GB:-4}"
MIN_DOCKER_VERSION="24.0.0"
MIN_DOCKER_API_VERSION="1.40"

ENV_FILE=""
OVERRIDE_FILE=""

SERVER_IP=""
VELIX_UPDATED_BY=""
VELIX_LOCAL_SSH_PORT="22"
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
GENERATED_ADMIN_PASSWORD="false"

UPDATE_MODE="false"
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

        # "Restarting (1)" na tabela acima não diz nada sobre a causa; o log do
        # container que morreu diz. Sem isso, toda falha de start vira uma ida
        # e volta manual ao `docker logs`.
        local container
        for container in velix-api velix-web velix-postgres; do
            if docker inspect "$container" >/dev/null 2>&1; then
                if [ "$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null)" != "running" ] ||
                   ! container_healthy "$container"; then
                    echo
                    echo "── Últimas linhas de ${container} ──"
                    docker logs --tail 40 "$container" 2>&1 | tee -a "$LOG_FILE" || true
                fi
            fi
        done
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
        rsync iptables fail2ban iproute2 util-linux openssh-client
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

# Atualizar não é reinstalar: se já existe um .env completo no diretório de
# instalação, todas as respostas já foram dadas uma vez e estão gravadas lá.
# Perguntar de novo (diretório, e-mail, senha, domínio, porta) só cria chance de
# o usuário digitar algo diferente e reconfigurar o que estava funcionando.
existing_installation() {
    local env_file="${INSTALL_DIR}/.env"
    [ -f "$env_file" ] || return 1
    [ -n "$(get_env_value WEB_ORIGIN "$env_file")" ] || return 1
    [ -n "$(get_env_value VELIX_ADMIN_EMAIL "$env_file")" ] || return 1
}

load_existing_configuration() {
    section "Atualizando instalação existente"

    ENV_FILE="${INSTALL_DIR}/.env"
    OVERRIDE_FILE="${INSTALL_DIR}/docker-compose.override.yml"

    ADMIN_EMAIL="$(get_env_value VELIX_ADMIN_EMAIL "$ENV_FILE")"
    ADMIN_PASSWORD="$(get_env_value VELIX_ADMIN_PASSWORD "$ENV_FILE")"
    VELIX_DOMAIN="$(get_env_value VELIX_DOMAIN "$ENV_FILE")"
    ACME_EMAIL="$(get_env_value TRAEFIK_ACME_EMAIL "$ENV_FILE")"
    PANEL_PORT="$(get_env_value VELIX_HTTP_PORT "$ENV_FILE")"
    WEB_ORIGIN="$(get_env_value WEB_ORIGIN "$ENV_FILE")"

    [ -n "$PANEL_PORT" ] || PANEL_PORT="$DEFAULT_PANEL_PORT"
    [ -n "$VELIX_DOMAIN" ] && USE_DOMAIN="true" || USE_DOMAIN="false"

    echo "  Diretório:       ${INSTALL_DIR}"
    echo "  Administrador:   ${ADMIN_EMAIL}"
    echo "  URL:             ${WEB_ORIGIN}"
    if [ "$USE_DOMAIN" = "true" ]; then
        echo "  Proxy:           Traefik (SSL Let's Encrypt)"
    else
        echo "  Porta:           ${PANEL_PORT}"
    fi
    echo
    success "Configuração existente reaproveitada — nenhuma pergunta necessária"
    echo -e "${GRAY}  Para reconfigurar do zero, remova ${ENV_FILE} e rode novamente.${NC}"
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
    success "$(docker compose version)"
}

# Traefik 3.3.x negocia a API do Docker na versão 1.24, que engines recentes
# (Docker 29+) já não aceitam ("client version 1.24 is too old"). A imagem
# traefik:v3.7 usada em generate_compose_override() corrige isso, mas só se o
# Docker instalado também for recente o bastante — checa os dois lados aqui,
# antes de subir os containers, em vez de deixar falhar num healthcheck confuso.
version_ge() {
    [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

check_traefik_compatibility() {
    section "Verificando compatibilidade Docker/Traefik"

    local docker_version docker_api_version
    docker_version="$(docker version --format '{{.Server.Version}}' 2>/dev/null)"
    docker_api_version="$(docker version --format '{{.Server.APIVersion}}' 2>/dev/null)"

    [ -n "$docker_version" ] || fatal "Não foi possível obter a versão do Docker (o daemon está rodando?)."

    version_ge "$docker_version" "$MIN_DOCKER_VERSION" \
        || fatal "Docker ${docker_version} é muito antigo (mínimo: ${MIN_DOCKER_VERSION}). Atualize o Docker Engine antes de continuar."

    version_ge "$docker_api_version" "$MIN_DOCKER_API_VERSION" \
        || fatal "API do Docker ${docker_api_version} é muito antiga (mínimo: ${MIN_DOCKER_API_VERSION}). Atualize o Docker Engine antes de continuar."

    success "Docker ${docker_version} (API ${docker_api_version}) compatível com Traefik v3.7"

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

    # .git vai junto de propósito (era excluído): sem um checkout de verdade em
    # INSTALL_DIR, o botão "Atualizar" do painel não teria de onde puxar código.
    run_step "Copiando arquivos do Velix" rsync -a --delete \
        --exclude='.env' \
        --exclude='.env.backup.*' \
        --exclude='docker-compose.override.yml' \
        --exclude='node_modules/' \
        --exclude='.next/' \
        --exclude='dist/' \
        "${SCRIPT_DIR}/" "${INSTALL_DIR}/"
}

# Mesma lógica do velix-self-update: o diretório de instalação é uma cópia do
# repositório, não um espaço de edição. `pull --ff-only` transformava qualquer
# divergência (histórico reescrito, arquivo mexido no servidor) em falha; aqui
# ela é descartada. Arquivos não rastreados — .env, override, volumes — não são
# tocados por `reset --hard`.
update_existing_repository() {
    local branch
    branch="$(git -C "$INSTALL_DIR" symbolic-ref --short HEAD 2>/dev/null || echo main)"

    run_step "Buscando atualizações do repositório" git -C "$INSTALL_DIR" fetch --prune origin
    run_step "Aplicando versão do repositório" git -C "$INSTALL_DIR" reset --hard "origin/${branch}"
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
    local cf_dns_api_token="$4"

    cat >"$ENV_FILE" <<EOF
POSTGRES_PASSWORD=${postgres_password}
JWT_SECRET=${jwt_secret}
VELIX_CREDENTIAL_SECRET=${credential_secret}
# Gravado pela API (não pelo instalador) quando uma conta Cloudflare é
# conectada e este servidor usa o Traefik compartilhado com o painel — ver
# TraefikService.syncSharedProxyCloudflareToken. Preservado abaixo em
# generate_environment() pelo mesmo motivo que os segredos acima: este arquivo
# é reescrito do zero a cada instalação/atualização, e sem preservar, toda
# atualização apagaria o token e o SSL das aplicações voltaria a quebrar.
CF_DNS_API_TOKEN=${cf_dns_api_token}
WEB_ORIGIN=${WEB_ORIGIN}
NEXT_PUBLIC_APP_URL=${WEB_ORIGIN}
VELIX_ADMIN_EMAIL=${ADMIN_EMAIL}
VELIX_ADMIN_PASSWORD=${ADMIN_PASSWORD}
VELIX_DOMAIN=${VELIX_DOMAIN}
VELIX_HTTP_PORT=${PANEL_PORT}
TRAEFIK_ACME_EMAIL=${ACME_EMAIL}
VELIX_UPDATED_BY=${VELIX_UPDATED_BY}
VELIX_INSTALL_DIR=${INSTALL_DIR}
VELIX_LOCAL_SERVER=true
VELIX_LOCAL_NAME=${VELIX_LOCAL_NAME}
VELIX_LOCAL_SSH_USER=root
VELIX_LOCAL_SSH_PORT=${VELIX_LOCAL_SSH_PORT}
VELIX_LOCAL_KEY_FILE=/host/velix/.velix-local-key
EOF
}

generate_environment() {
    section "Gerando configurações"

    # Quem está rodando o instalador — a API grava isso no histórico de
    # atualizações. SUDO_USER é o usuário real por trás do sudo; sem sudo (root
    # direto) sobra o próprio usuário efetivo.
    # Respeita um valor já definido no ambiente: é assim que o velix-self-update
    # informa quem clicou no botão do painel, em vez do root do systemd.
    VELIX_UPDATED_BY="${VELIX_UPDATED_BY:-${SUDO_USER:-$(id -un)}@$(hostname -s 2>/dev/null || echo servidor)}"
    VELIX_LOCAL_NAME="$(hostname -s 2>/dev/null || echo "Este servidor")"

    local postgres_password=""
    local jwt_secret=""
    local credential_secret=""
    local cf_dns_api_token=""

    if [ -f "$ENV_FILE" ]; then
        local backup_file="${ENV_FILE}.backup.$(date +%Y%m%d-%H%M%S)"
        cp "$ENV_FILE" "$backup_file"

        postgres_password="$(get_env_value POSTGRES_PASSWORD "$ENV_FILE")"
        jwt_secret="$(get_env_value JWT_SECRET "$ENV_FILE")"
        credential_secret="$(get_env_value VELIX_CREDENTIAL_SECRET "$ENV_FILE")"
        cf_dns_api_token="$(get_env_value CF_DNS_API_TOKEN "$ENV_FILE")"

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

    # Sem valor padrão gerado aqui, de propósito: um token do Cloudflare não é
    # algo que o instalador tem como criar sozinho. Fica vazio até a API gravá-lo.

    write_env_file "$postgres_password" "$jwt_secret" "$credential_secret" "$cf_dns_api_token"
    chmod 600 "$ENV_FILE"
    chown root:root "$ENV_FILE"

    success "Variáveis e segredos gerados"
}

generate_compose_override() {
    section "Configurando acesso ao painel"

    if [ "$USE_DOMAIN" = "true" ]; then
        # O Traefik do Velix passa a ser também o proxy das aplicações do painel.
        # O diretório precisa existir antes do container subir (bind mount de
        # caminho inexistente vira um diretório vazio de propriedade do root, e
        # o Traefik acusa provedor de arquivo inválido), e a rede precisa existir
        # porque o compose a declara como externa.
        mkdir -p "${INSTALL_DIR}/traefik/dynamic"
        docker network create velix-proxy >/dev/null 2>&1 || true

        # Marca que este Traefik atende o painel: é o que a API usa pra saber
        # que não precisa instalar outro neste servidor (ver TraefikService).
        touch "${INSTALL_DIR}/traefik/.velix-shared-proxy"
    fi

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
    image: traefik:v3.7
    container_name: velix-traefik
    restart: unless-stopped
    command:
      - "--api.dashboard=false"
      - "--api.insecure=false"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      # Provedor de arquivo: é o que permite o painel publicar aplicações com
      # domínio NESTE servidor. Sem ele, o Traefik do Velix leria só labels do
      # Docker, e as rotas que o painel escreve em arquivo seriam ignoradas —
      # obrigando a instalar um segundo Traefik que colidiria nas portas 80/443.
      - "--providers.file.directory=/etc/traefik/dynamic"
      - "--providers.file.watch=true"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.email=${TRAEFIK_ACME_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      # Resolvedor com o nome que as rotas do painel referenciam — mas desafio
      # diferente do "letsencrypt" acima, de propósito. DNS-01 via Cloudflare
      # em vez de HTTP-01: um domínio com o proxy laranja da Cloudflare ligado
      # nunca completa HTTP-01 (o desafio bate no edge da Cloudflare, não neste
      # servidor), e HTTP-01 puro depende da porta 80 estar alcançável de fora
      # sem nenhum intermediário — DNS-01 funciona nos dois casos e é o mesmo
      # método que o Traefik instalado pelo painel já usa em servidores
      # remotos (ver TraefikService.installTraefik). O token só passa a existir
      # de verdade quando uma conta Cloudflare é conectada — a API grava
      # CF_DNS_API_TOKEN neste .env e reinicia só o serviço traefik quando isso
      # acontece (ver TraefikService.syncSharedProxyCloudflareToken). Sem
      # conta conectada, o valor fica vazio e a emissão para apps deste
      # resolvedor simplesmente não completa — sem quebrar o "letsencrypt" do
      # painel, que não depende de nada disso.
      - "--certificatesresolvers.velix-le.acme.email=${TRAEFIK_ACME_EMAIL}"
      - "--certificatesresolvers.velix-le.acme.storage=/letsencrypt/acme-dns.json"
      - "--certificatesresolvers.velix-le.acme.dnschallenge=true"
      - "--certificatesresolvers.velix-le.acme.dnschallenge.provider=cloudflare"
      - "--certificatesresolvers.velix-le.acme.dnschallenge.resolvers=1.1.1.1:53,8.8.8.8:53"
      - "--ping=true"
      - "--log.level=INFO"
      - "--accesslog=true"
    environment:
      - CF_DNS_API_TOKEN=${CF_DNS_API_TOKEN:-}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - velix_letsencrypt:/letsencrypt
      - ${VELIX_INSTALL_DIR:-/opt/velix}/traefik/dynamic:/etc/traefik/dynamic:ro
    networks:
      - velix_proxy
      - velix-proxy
    healthcheck:
      test: ["CMD", "traefik", "healthcheck", "--ping"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 10s

volumes:
  velix_letsencrypt:
    name: velix_letsencrypt

networks:
  # Rede onde as aplicações implantadas pelo painel entram. Criada aqui como
  # externa porque quem a cria primeiro é o motor de implantação; declarar sem
  # `external` faria o compose criar uma segunda rede com nome prefixado.
  velix-proxy:
    name: velix-proxy
    external: true
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
    # Numa atualização o domínio já respondeu antes; revalidar só rende uma
    # pergunta a mais quando o DNS está atrás de proxy (Cloudflare, por ex.).
    [ "$UPDATE_MODE" = "true" ] && return

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
    # Numa atualização a porta está ocupada pelo próprio Velix que está no ar —
    # avisar sobre isso e pedir confirmação seria só ruído.
    [ "$UPDATE_MODE" = "true" ] && return

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

# Uma porta por linha, não separadas por espaço: este script roda com
# IFS=$'\n\t' (ver topo), então `for port in $(public_ports)` NÃO quebraria em
# espaços — viraria uma palavra só, "80 443", e o ufw responderia "Bad port".
public_ports() {
    if [ "$USE_DOMAIN" = "true" ]; then
        printf '80\n443\n'
    else
        printf '%s\n' "$PANEL_PORT"
    fi
}

# Mesma lista numa linha só, pra exibir e pra embutir no script de firewall.
public_ports_inline() {
    public_ports | tr '\n' ' '
}

# Portas publicadas por containers entram pelo FORWARD e são NATeadas antes do
# INPUT — ou seja, o UFW não as vê e um "ufw deny" não bloqueia nada que o
# compose exponha. DOCKER-USER é a única chain consultada pelo Docker antes das
# regras dele e preservada entre reinícios do daemon, então é onde a política
# externa dos containers precisa morar. O script é reaplicado a cada boot pelo
# ExecStartPre do velix.service, já que o iptables não persiste sozinho.
write_firewall_script() {
    cat >"$FIREWALL_SCRIPT" <<EOF
#!/usr/bin/env bash
# Gerado pelo install.sh do Velix — reaplicado a cada boot por velix.service.
#
# Para liberar outras portas de containers deste host, adicione-as a PORTS e
# rode: systemctl restart velix
PORTS="$(public_ports_inline)"
EOF

    cat >>"$FIREWALL_SCRIPT" <<'EOF'

set -eu

iptables -w -N DOCKER-USER 2>/dev/null || true
iptables -w -F DOCKER-USER

# Interface de saída padrão: só o tráfego que chega por ela é considerado
# externo. Tráfego entre containers e da rede interna continua livre.
WAN="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "dev") {print $(i + 1); exit}}')"

iptables -w -A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

for port in $PORTS; do
    iptables -w -A DOCKER-USER -p tcp --dport "$port" -j ACCEPT
done

if [ -n "$WAN" ]; then
    iptables -w -A DOCKER-USER -i "$WAN" -j DROP
fi

iptables -w -A DOCKER-USER -j RETURN
EOF

    chmod 700 "$FIREWALL_SCRIPT"
}

# Uma única ferramenta: iptables direto, na chain DOCKER-USER. O UFW saiu daqui
# — ele é um frontend do próprio iptables, então manter os dois era escrever nas
# mesmas tabelas por dois caminhos diferentes, com o instalador dependendo do
# estado de um serviço que ele não controla.
#
# O que este instalador NÃO gerencia é a chain INPUT (tráfego para o host, não
# para os containers). É de propósito: só o dono da máquina sabe o que mais ela
# serve — SSH numa porta trocada, SMTP, DNS, um serviço legado — e uma política
# padrão DROP escrita às cegas aqui derrubaria isso junto, sem aviso e sem
# retorno fácil num servidor remoto. Regras de host continuam por sua conta;
# o fail2ban configurado logo abaixo também escreve na INPUT e segue valendo.
configure_firewall() {
    section "Configurando firewall"

    write_firewall_script
    run_step "Aplicando regras de iptables aos containers" "$FIREWALL_SCRIPT"
    success "Portas liberadas nos containers: $(public_ports_inline)"
    echo -e "${GRAY}  Regras em DOCKER-USER, reaplicadas a cada boot pelo velix.service.${NC}"
    echo -e "${GRAY}  Tráfego para o próprio host (SSH, e-mail, etc.) não é alterado.${NC}"
}

# Permite instalar aplicações no próprio servidor onde o Velix roda, sem
# cadastrar nada à mão.
#
# O painel fala com qualquer servidor por SSH — inclusive com este. Em vez de
# criar um "modo local" paralelo em cada operação (deploy, Traefik, banco,
# terminal), o que dobraria o código e obrigaria a escrever todo recurso novo
# duas vezes, geramos um par de chaves e autorizamos a pública no próprio host.
# A API então trata a máquina local como mais um servidor gerenciado.
#
# Isso dá à API acesso SSH ao host. É o mesmo poder que ela já tem sobre
# qualquer servidor cadastrado, agora apontado pra si mesma — a diferença é que
# aqui a decisão é explícita. Pra desativar: remova VELIX_LOCAL_SERVER do .env,
# apague a chave em ${INSTALL_DIR}/.velix-local-key e a linha correspondente em
# /root/.ssh/authorized_keys.
configure_local_server() {
    section "Habilitando o próprio servidor"

    local key_file="${INSTALL_DIR}/.velix-local-key"
    local authorized="/root/.ssh/authorized_keys"

    if [ ! -f "$key_file" ]; then
        run_step "Gerando chave de acesso local" ssh-keygen -t ed25519 -N "" -C "velix-local" -f "$key_file"
    fi

    mkdir -p /root/.ssh
    chmod 700 /root/.ssh
    touch "$authorized"
    chmod 600 "$authorized"

    local pubkey
    pubkey="$(cat "${key_file}.pub")"
    if ! grep -qF "$pubkey" "$authorized"; then
        echo "$pubkey" >>"$authorized"
        success "Chave do Velix autorizada em ${authorized}"
    else
        success "Chave do Velix já autorizada"
    fi

    # A chave é lida pela API por dentro do volume; 600 e dono root bastam,
    # já que o container roda como root e o host não expõe o diretório.
    chmod 600 "$key_file"

    # Porta real do sshd, não o padrão 22 chutado: quem troca a porta do SSH
    # por segurança teria o servidor local nascendo quebrado.
    VELIX_LOCAL_SSH_PORT="$(awk '/^[[:space:]]*Port[[:space:]]+[0-9]+/ {print $2; exit}' /etc/ssh/sshd_config 2>/dev/null || true)"
    [ -n "$VELIX_LOCAL_SSH_PORT" ] || VELIX_LOCAL_SSH_PORT=22

    # PermitRootLogin no bloqueia até chave — melhor avisar agora do que deixar
    # o painel mostrar "offline" sem explicação.
    if grep -qE '^[[:space:]]*PermitRootLogin[[:space:]]+no' /etc/ssh/sshd_config 2>/dev/null; then
        warning "PermitRootLogin está como \"no\" — o Velix não vai conseguir se conectar a este servidor."
        warning "Ajuste para \"prohibit-password\" em /etc/ssh/sshd_config e rode: systemctl reload ssh"
    fi

    success "Este servidor aparecerá no painel na porta ${VELIX_LOCAL_SSH_PORT}"
}

configure_fail2ban() {
    section "Configurando fail2ban"

    command -v fail2ban-server >/dev/null 2>&1 || {
        warning "fail2ban não encontrado; proteção contra força bruta não foi ativada"
        return
    }

    # backend=systemd porque Ubuntu 24.04+ não instala rsyslog e o jail padrão
    # (auto) procura /var/log/auth.log, que não existe — o serviço sobe mas o
    # jail fica sem ler nada. banaction=iptables-multiport funciona com ou sem
    # UFW ativo, e as regras ficam em chains próprias do fail2ban.
    cat >/etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime   = 1h
findtime  = 10m
maxretry  = 5
banaction = iptables-multiport

[sshd]
enabled = true
backend = systemd
EOF

    run_step "Ativando fail2ban" systemctl enable fail2ban
    run_step "Reiniciando fail2ban" systemctl restart fail2ban
    success "Jail sshd ativo: 5 tentativas em 10 min, banimento de 1 hora"
}

# Atualização pelo painel sem dar o socket do Docker pra API.
#
# A API roda dentro de um dos containers que a atualização substitui — ela não
# pode conduzir o próprio rebuild. A saída comum é montar /var/run/docker.sock
# no container, o que equivale a entregar root do host pra aplicação web.
# Aqui o caminho é outro: a API só escreve um arquivo de pedido no diretório de
# instalação (que ela já enxerga por volume), e quem age é o host — um path
# unit do systemd que dispara UM script fixo, sem parâmetros vindos da rede.
# O pior caso de um comprometimento da API é disparar a atualização oficial.
write_self_update_units() {
    cat >"$SELF_UPDATE_SCRIPT" <<EOF
#!/usr/bin/env bash
# Gerado pelo install.sh do Velix — disparado pelo velix-updater.path.
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR}"
EOF

    cat >>"$SELF_UPDATE_SCRIPT" <<'SCRIPT'
REQUEST="${INSTALL_DIR}/.velix-update-request"
STATUS="${INSTALL_DIR}/.velix-update-status"
UPDATE_LOG="${INSTALL_DIR}/.velix-update.log"

[ -f "$REQUEST" ] || exit 0

requested_by="$(tr ',' '\n' <"$REQUEST" | grep '"requestedBy"' | cut -d'"' -f4 | head -n1)"
[ -n "$requested_by" ] || requested_by="painel"
from_version="$(cat "${INSTALL_DIR}/apps/api/VERSION" 2>/dev/null || echo '')"

rm -f "$REQUEST"

write_status() {
    cat >"$STATUS" <<JSON
{"state":"$1","requestedBy":"${requested_by}","fromVersion":"${from_version}","message":"$2","updatedAt":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')"}
JSON
    chmod 644 "$STATUS"
}

: >"$UPDATE_LOG"
chmod 644 "$UPDATE_LOG"

write_status running "Baixando a nova versão"

# fetch + reset --hard, não `pull --ff-only`. O --ff-only existe pra proteger
# trabalho local, e aqui não existe trabalho local: o diretório de instalação é
# uma cópia do repositório, não um espaço de edição. Com ele, qualquer
# divergência — histórico reescrito no remoto, um arquivo editado à mão no
# servidor, um merge pendente — vira falha de atualização em vez de ser
# descartada, que é o que se quer num diretório de deploy.
#
# `reset --hard` não remove arquivos não rastreados, então .env,
# docker-compose.override.yml e os arquivos de estado desta atualização
# sobrevivem. Nenhum `git clean` aqui, justamente por isso.
branch="$(git -C "$INSTALL_DIR" symbolic-ref --short HEAD 2>/dev/null || echo main)"

if ! git -C "$INSTALL_DIR" fetch --prune origin >>"$UPDATE_LOG" 2>&1; then
    write_status error "Falha ao contatar o GitHub (git fetch)"
    exit 1
fi

if ! git -C "$INSTALL_DIR" reset --hard "origin/${branch}" >>"$UPDATE_LOG" 2>&1; then
    write_status error "Falha ao aplicar a nova versão (git reset)"
    exit 1
fi

write_status running "Reconstruindo e reiniciando os serviços"
if ! VELIX_UPDATED_BY="$requested_by" INSTALL_DIR="$INSTALL_DIR" bash "${INSTALL_DIR}/install.sh" >>"$UPDATE_LOG" 2>&1; then
    write_status error "Falha ao aplicar a atualização — veja .velix-update.log"
    exit 1
fi

write_status success "Atualização concluída"
SCRIPT

    chmod 700 "$SELF_UPDATE_SCRIPT"

    # PathChanged em vez de um serviço que fica de pé esperando: o host não
    # mantém processo nenhum enquanto ninguém pede atualização.
    cat >/etc/systemd/system/velix-updater.path <<EOF
[Unit]
Description=Observa pedidos de atualização do painel Velix

[Path]
PathExists=${INSTALL_DIR}/.velix-update-request
Unit=velix-updater.service

[Install]
WantedBy=multi-user.target
EOF

    cat >/etc/systemd/system/velix-updater.service <<EOF
[Unit]
Description=Aplica a atualização do Velix pedida pelo painel
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=${SELF_UPDATE_SCRIPT}
TimeoutStartSec=0
EOF

    run_step "Ativando atualização pelo painel" systemctl enable --now velix-updater.path
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
ExecStartPre=-${FIREWALL_SCRIPT}
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

    # Sem isso o painel mostra "—" no commit pra sempre. Vem do checkout de
    # onde o instalador foi executado; se não for um repositório git, fica vazio
    # e o comportamento é o de antes.
    export GIT_COMMIT="$(git -C "$SCRIPT_DIR" rev-parse --short HEAD 2>/dev/null || echo '')"
    export BUILD_DATE="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

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

# postgres, api e web têm HEALTHCHECK real definido (ver docker-compose.yml)
# — "running" sozinho não prova nada, um container pode estar "running" no
# instante exato entre dois ciclos de um restart loop. Containers sem
# healthcheck (nenhum definido) contam como ok assim que estão "running",
# senão o script travaria esperando um sinal que nunca chega.
container_healthy() {
    local container="$1"
    local health
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || true)"
    [ "$health" = "healthy" ] || [ "$health" = "none" ]
}

wait_for_containers() {
    section "Verificando serviços"

    local attempt postgres_status api_status web_status

    for attempt in $(seq 1 60); do
        postgres_status="$(container_state velix-postgres)"
        api_status="$(container_state velix-api)"
        web_status="$(container_state velix-web)"

        if [ "$postgres_status" = "running" ] && container_healthy velix-postgres &&
           [ "$api_status" = "running" ] && container_healthy velix-api &&
           [ "$web_status" = "running" ] && container_healthy velix-web; then
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
    if [ "$UPDATE_MODE" = "true" ]; then
        section "Atualização concluída"
        echo -e "${GREEN}${BOLD}  ✔ Velix atualizado para ${VELIX_VERSION}${NC}"
    else
        section "Instalação concluída"
        echo -e "${GREEN}${BOLD}  ✔ Velix instalado com sucesso${NC}"
    fi
    echo
    echo "  URL:             ${WEB_ORIGIN}"
    echo "  Administrador:   ${ADMIN_EMAIL}"
    if [ "$UPDATE_MODE" = "true" ]; then
        echo "  Senha:           (inalterada)"
    else
        echo "  Senha:           ${ADMIN_PASSWORD}"
    fi
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
    echo "  iptables -S DOCKER-USER"
    echo "  fail2ban-client status sshd"
    echo

    if [ "$UPDATE_MODE" != "true" ]; then
        warning "Guarde a senha administrativa em local seguro."
    fi
    warning "O arquivo .env contém senhas e segredos do sistema."
}

acquire_lock() {
    # Duas execuções ao mesmo tempo — atualização pelo painel cruzando com um
    # `sudo ./install.sh` manual por SSH, ou o mesmo comando disparado duas
    # vezes — competem por apt, Docker e RAM sem gerar erro nenhum: só trava
    # tudo, mais grave ainda num servidor com pouca memória. `flock -n` recusa
    # na hora se outro processo já segura o lock, em vez de deixar os dois
    # avançarem em paralelo.
    exec 200>"$LOCK_FILE"
    if ! flock -n 200; then
        local holder
        holder="$(fuser "$LOCK_FILE" 2>/dev/null | tr -d ' ')"
        fatal "Já existe uma instalação ou atualização do Velix em andamento${holder:+ (PID ${holder})}. Aguarde terminar ou verifique: ps aux | grep install.sh"
    fi
}

main() {
    acquire_lock
    prepare_log
    show_banner
    require_root
    detect_system
    check_hardware
    install_dependencies
    ensure_swap
    detect_public_ip
    if existing_installation; then
        UPDATE_MODE="true"
        load_existing_configuration
    else
        collect_configuration
    fi
    install_docker
    check_traefik_compatibility
    prepare_source
    check_required_ports
    configure_local_server
    generate_environment
    generate_compose_override
    check_dns
    configure_firewall
    configure_fail2ban
    create_systemd_service
    write_self_update_units
    deploy_velix
    wait_for_containers
    wait_for_panel
    show_result
}

main "$@"

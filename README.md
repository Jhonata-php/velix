# Velix

Velix é uma plataforma para gerenciamento de servidores Linux via SSH, criada para centralizar infraestrutura, aplicações, atualizações, Docker, bancos de dados, DNS, métricas e acesso remoto em uma única interface.

O sistema executa operações reais nos servidores cadastrados, sem simulações.

## Recursos implementados

Atualmente o Velix possui:

- autenticação com JWT;
- dashboard de infraestrutura;
- tema claro e escuro;
- cadastro e gerenciamento de servidores Linux;
- teste real de conexão SSH;
- métricas reais coletadas por SSH;
- terminal web com shell SSH real;
- gerenciamento de atualizações Linux;
- gerenciamento de Docker;
- instalação automatizada do EasyPanel;
- integração com Cloudflare;
- gerenciamento de DNS;
- instalação de MySQL via Docker;
- replicação MySQL com GTID;
- promoção manual de réplica;
- monitoramento de sincronização MySQL;
- reinicialização remota de servidores.

## Funcionalidades detalhadas

### Servidores Linux

O Velix permite cadastrar servidores utilizando:

- endereço IP ou hostname;
- porta SSH;
- usuário SSH;
- senha ou chave privada;
- descrição e identificação do servidor.

As credenciais são utilizadas para estabelecer conexões SSH reais.

### Métricas

O sistema coleta por SSH:

- uptime;
- load average;
- uso de memória RAM;
- utilização de disco;
- status do servidor.

As métricas são atualizadas automaticamente a cada 10 segundos no dashboard e na página do servidor.

Também é possível solicitar uma atualização manual.

### Terminal web

O terminal web utiliza:

- WebSocket;
- `xterm.js`;
- conexão SSH real;
- proxy interno pelo frontend.

O navegador não se conecta diretamente à API ou ao servidor SSH.

### Atualizações Linux

O Velix identifica automaticamente o gerenciador de pacotes do servidor:

- `apt`;
- `dnf`;
- `yum`.

É possível:

- verificar atualizações disponíveis;
- instalar todas as atualizações;
- instalar somente atualizações de segurança.

### Docker

O Velix pode:

- verificar se o Docker está instalado;
- instalar Docker usando o instalador oficial;
- consultar o status do serviço;
- listar containers;
- visualizar o estado dos containers.

### EasyPanel

É possível instalar o EasyPanel remotamente utilizando o instalador oficial.

Quando a integração com Cloudflare está configurada, o Velix também pode criar automaticamente o registro DNS necessário.

### Cloudflare

Na área de configurações, é possível cadastrar:

- token da API;
- conta Cloudflare;
- zona DNS.

O sistema permite:

- listar zonas;
- listar registros DNS;
- criar registros;
- editar registros;
- excluir registros;
- descobrir domínios que apontam para determinado IP.

### MySQL

O Velix possui instalação de MySQL via Docker preparada para replicação.

Recursos atuais:

- instalação do MySQL principal;
- criação de réplica;
- dump do banco;
- transferência por SFTP;
- configuração com `CHANGE REPLICATION SOURCE`;
- replicação com GTID;
- acompanhamento do status da réplica;
- promoção manual da réplica.

A promoção exige confirmação explícita.

O failover automático ainda não está habilitado para evitar cenários de split-brain e corrupção de dados.

## Recursos ainda não implementados

Os seguintes recursos estão planejados:

- Docker Swarm;
- gerenciamento de clusters;
- PostgreSQL;
- backups agendados;
- restauração de backups;
- failover automático;
- máquina de estados para failover;
- fencing real;
- MFA para terminal;
- gravação de sessões SSH;
- limite de sessões simultâneas;
- auditoria avançada;
- biblioteca de aplicações;
- deploy de aplicações por templates.

## Arquitetura

O projeto é dividido em duas aplicações principais.

### API

Localização:

```text
apps/api
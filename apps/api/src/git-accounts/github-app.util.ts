/** Funções puras do fluxo de GitHub App via manifest — sem I/O, testáveis
 * sem rede. Ver github-app.util.spec.ts. */

/**
 * Nome do App visto no GitHub. Precisa ser único em TODO o GitHub (não só
 * na conta do usuário) — por isso o sufixo aleatório, mesmo que o rótulo
 * escolhido já tenha sido usado por outra instalação do Velix em outro
 * lugar. Limite prático de comprimento do GitHub pra nome de App é curto,
 * daí o corte do rótulo.
 */
export function buildManifestName(label: string, randomSuffix: string): string {
  const clean = label.trim().slice(0, 20) || 'conta';
  return `Velix ${clean} ${randomSuffix}`;
}

export interface ManifestOptions {
  label: string;
  randomSuffix: string;
  webOrigin: string;
}

/** JSON do manifest enviado ao GitHub — https://github.com/settings/apps/new?state=... */
export function buildManifest({ label, randomSuffix, webOrigin }: ManifestOptions) {
  const base = webOrigin.replace(/\/$/, '');
  return {
    name: buildManifestName(label, randomSuffix),
    url: base,
    redirect_url: `${base}/api/git-accounts/github/callback`,
    setup_url: `${base}/api/git-accounts/github/installed`,
    setup_on_update: true,
    public: false,
    default_events: [],
    // ponytail: "administration" já foi pedido aqui pra tentar criar webhook
    // de autodeploy via API pra contas GitHub App — não adianta, a API
    // clássica de webhooks (POST /repos/:owner/:repo/hooks) rejeita token de
    // instalação de App com "Resource not accessible by integration"
    // independente de permissão concedida (limitação do GitHub, não nossa).
    // GitDeployService.tryCreateGitHubWebhook já pula a tentativa pra contas
    // github_app, então não tem motivo pra pedir uma permissão mais ampla
    // que o Velix nunca usa — token pessoal (PAT) é o único caminho pra essa
    // automação hoje.
    default_permissions: {
      contents: 'read',
      metadata: 'read',
    },
    // Nenhum evento assinado (default_events vazio) — active:false garante
    // que o GitHub nunca tenta entregar nada aqui, a URL só precisa existir
    // pra passar na validação do manifest.
    hook_attributes: {
      url: `${base}/api/git-accounts/github/callback`,
      active: false,
    },
  };
}

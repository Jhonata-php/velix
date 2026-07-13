export interface UpgradablePackage {
  name: string;
  version: string;
  security: boolean;
}

/** Parseia a saída de `apt list --upgradable`. */
export function parseAptUpgradable(output: string): UpgradablePackage[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line.includes('/'))
    .map((line) => {
      const [name, suitesPart] = line.split('/');
      const rest = suitesPart?.split(' ') ?? [];
      const suites = rest[0] ?? '';
      const version = rest[1] ?? '';
      return { name, version, security: suites.toLowerCase().includes('security') };
    });
}

/** Parseia a saída de `dnf check-update` / `yum check-update` (formato "pkg.arch  version  repo"). */
export function parseDnfUpgradable(output: string, securityPackageNames: Set<string>): UpgradablePackage[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('Last metadata') && !line.startsWith('Obsoleting'))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 2)
    .map(([pkgArch, version]) => {
      const name = pkgArch.replace(/\.[^.]+$/, '');
      return { name, version, security: securityPackageNames.has(name) };
    });
}

/** Extrai nomes de pacotes da saída de `dnf/yum updateinfo list security`. */
export function parseSecurityPackageNames(output: string): Set<string> {
  const names = output
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 3)
    .map((parts) => parts[2].replace(/\.[^.]+$/, ''));
  return new Set(names);
}

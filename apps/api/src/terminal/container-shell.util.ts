/** Funções puras do terminal dentro de um container — sem I/O, testáveis
 * sem rede/SSH. Ver container-shell.util.spec.ts. */

/**
 * Cliente de banco certo pra abrir dentro do container, a partir da imagem
 * declarada no manifesto — sem tentar logar sozinho (o usuário digita a
 * senha na hora, do jeito que já viu na aba Ambiente): detectar o cliente
 * certo já poupa o usuário de saber o nome do binário, e evitar login
 * automático evita guardar/derivar senha de bancos de terceiros que nem
 * sempre usam a mesma variável de ambiente entre manifestos.
 */
export function dbConsoleCommand(image: string): string | null {
  const img = image.toLowerCase();
  if (img.includes('postgres')) return 'psql -U postgres';
  if (img.includes('mysql') || img.includes('mariadb')) return 'mysql -u root -p';
  if (img.includes('mongo')) return 'mongosh';
  if (img.includes('redis')) return 'redis-cli';
  return null;
}

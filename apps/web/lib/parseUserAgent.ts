// Leitor de user-agent bem simples, só pra exibir "Chrome no macOS" em vez do
// header cru na lista de sessões — não precisa ser exaustivo (não é usado pra
// nenhuma decisão de segurança, só apresentação).
export function parseUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'Dispositivo desconhecido';

  let browser = 'Navegador desconhecido';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/chrome\//i.test(ua) && !/chromium/i.test(ua)) browser = 'Chrome';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/safari\//i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  else if (/curl\//i.test(ua)) browser = 'curl (CLI)';

  let os = 'sistema desconhecido';
  if (/iphone/i.test(ua)) os = 'iPhone';
  else if (/ipad/i.test(ua)) os = 'iPad';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/mac os x/i.test(ua)) os = 'macOS';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/linux/i.test(ua)) os = 'Linux';

  return `${browser} em ${os}`;
}

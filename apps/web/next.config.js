/** @type {import('next').NextConfig} */
const nextConfig = {
  // Proxeia /api/* para o backend Nest no servidor do Next.js — o browser só
  // fala com esta porta, então não existe requisição cross-origin (nem CORS
  // pra configurar) e o usuário só precisa expor/acessar uma porta só.
  async rewrites() {
    const apiUrl = process.env.INTERNAL_API_URL ?? 'http://localhost:3001/api';
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};

module.exports = nextConfig;

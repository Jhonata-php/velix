/** @type {import('next').NextConfig} */
const nextConfig = {};

// ponytail-bugfix: o proxy de /api/* (e dos WebSockets /terminal, /ops) mora
// em server.js, não aqui. `rewrites()` resolveria INTERNAL_API_URL uma única
// vez no build e congelaria isso no routes-manifest.json — quebraria em
// produção Docker, onde o hostname do backend (ex. "api") só existe em
// runtime, não durante `docker build`.
module.exports = nextConfig;

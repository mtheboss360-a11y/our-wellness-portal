import type { IncomingMessage } from 'node:http';
// The address rate limits are keyed on. Behind proxies, X-Forwarded-For reads "what the client sent, then one address
// per proxy". Every proxy appends, none strips, so only the entries the trusted proxies added can be believed: the
// client is the entry `hops` places from the right. hops is the number of proxies in front of this server (1 for
// Render alone, 2 for Cloudflare in front of Render). Never the leftmost entry: the client writes that one itself.
export function clientIp(request: IncomingMessage, trustProxy?: boolean, hops = 1) {
  const socket = request.socket.remoteAddress ?? 'unknown';
  const header = request.headers['x-forwarded-for'];
  if (!trustProxy || typeof header !== 'string') return socket;
  const chain = header.split(',').map(part => part.trim()).filter(Boolean);
  return chain.length >= hops ? chain[chain.length - hops] : socket;
}

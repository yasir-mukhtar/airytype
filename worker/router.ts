import { handlePublication, type PublicationConfig } from './publication';

type AssetBinding = { fetch(request: Request): Promise<Response> };

export async function handleRequest(
  request: Request,
  config: PublicationConfig,
  assets: AssetBinding,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/p' || path.startsWith('/p/'))
    return handlePublication(request, config);
  if (path === '/api' || path.startsWith('/api/')) {
    // Permanent deletion is unavailable until the external receipt protocol exists.
    return new Response(request.method === 'HEAD' ? null : 'Not found.\n', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed.\n', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }
  // Configure assets.not_found_handling = "none": unknown URLs must remain 404.
  return assets.fetch(request);
}

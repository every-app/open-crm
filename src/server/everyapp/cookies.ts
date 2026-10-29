// The gateway strips every Cookie header before a request reaches the CRM
// and refuses requests whose cookies repeat its own session cookie's name, so
// nothing the CRM's server sets as a cookie could ever be read back, and a
// session cookie could collide with the gateway's. No route sets one; this
// keeps it that way. A WebSocket upgrade passes through untouched.
export function withoutCookies(response: Response): Response {
  if (response.status === 101 || !response.headers.has("set-cookie")) {
    return response;
  }
  console.warn("[everyapp] Dropped a Set-Cookie header behind the gateway");
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

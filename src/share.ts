/**
 * Shareable links.
 *
 * The workspace ({ input, source, target } — never the output, which is derivable) is
 * JSON'd, deflated, base64url'd, and put in the URL **hash**. Hashes are never sent to
 * the server, so a shared query stays between the two people who have the link — it
 * never lands in Vercel's request logs.
 *
 * `CompressionStream` covers every current browser; the uncompressed fallback is there
 * for the rare one that lacks it. A one-char scheme prefix records which was used.
 */

export interface SharePayload {
  v: 1
  input: string
  source: string
  target: string
}

/** URLs past this get silently truncated by chat clients and mail — refuse instead. */
const MAX_TOKEN_LENGTH = 8000

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

/**
 * Encode a workspace to a share token, or null if the link would be too long to survive
 * being pasted around.
 */
export async function encodeShare(payload: SharePayload): Promise<string | null> {
  const json = JSON.stringify(payload)
  let token: string
  try {
    if (typeof CompressionStream === 'function') {
      token = `c${toBase64Url(await deflate(json))}`
    } else {
      token = `r${toBase64Url(new TextEncoder().encode(json))}`
    }
  } catch {
    token = `r${toBase64Url(new TextEncoder().encode(json))}`
  }
  return token.length > MAX_TOKEN_LENGTH ? null : token
}

/** Decode a share token. Returns null for anything malformed or from a newer schema. */
export async function decodeShare(token: string): Promise<SharePayload | null> {
  try {
    const scheme = token[0]
    const bytes = fromBase64Url(token.slice(1))
    const json = scheme === 'c' ? await inflate(bytes) : new TextDecoder().decode(bytes)
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) return null
    const p = parsed as Record<string, unknown>
    if (p.v !== 1) return null
    return {
      v: 1,
      input: typeof p.input === 'string' ? p.input : '',
      source: typeof p.source === 'string' ? p.source : 'oracle',
      target: typeof p.target === 'string' ? p.target : 'mysql',
    }
  } catch {
    return null
  }
}

/** Pull the `s=` token out of a location hash. Pure, for testing. */
export function parseShareToken(hash: string): string | null {
  const match = /[#&]s=([^&]+)/.exec(hash)
  return match ? match[1] : null
}

export function readShareToken(): string | null {
  try {
    return parseShareToken(window.location.hash)
  } catch {
    return null
  }
}

/** Drop the share token from the address bar without reloading or adding history. */
export function clearShareToken(): void {
  try {
    if (readShareToken() === null) return
    const { pathname, search } = window.location
    window.history.replaceState(null, '', pathname + search)
  } catch {
    /* no history API */
  }
}

export function buildShareUrl(token: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#s=${token}`
}

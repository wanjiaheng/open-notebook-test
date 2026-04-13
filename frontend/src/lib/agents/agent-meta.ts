const AGENT_META_PREFIX = '__agent_meta__:'

type AgentMeta = {
  isAgent: boolean
  published?: boolean
}

export function parseAgentMeta(description?: string | null): {
  isAgent: boolean
  published: boolean
  plainDescription: string
} {
  const raw = description ?? ''
  if (!raw.startsWith(AGENT_META_PREFIX)) {
    return { isAgent: false, published: false, plainDescription: raw }
  }

  const lineEnd = raw.indexOf('\n')
  const metaRaw = (lineEnd === -1 ? raw.slice(AGENT_META_PREFIX.length) : raw.slice(AGENT_META_PREFIX.length, lineEnd)).trim()
  const plainDescription = lineEnd === -1 ? '' : raw.slice(lineEnd + 1).trim()

  try {
    const meta = JSON.parse(metaRaw) as AgentMeta
    return {
      isAgent: meta.isAgent === true,
      published: meta.published === true,
      plainDescription,
    }
  } catch {
    return { isAgent: false, published: false, plainDescription: raw }
  }
}

export function buildAgentDescription(plainDescription: string, published: boolean): string {
  const meta = JSON.stringify({ isAgent: true, published })
  const body = plainDescription.trim()
  return `${AGENT_META_PREFIX}${meta}\n${body}`
}

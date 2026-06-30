import type { DeveloperSuggestion, ResourceImpact } from '../types/index.js';

const IMAGE_THRESHOLD_BYTES = 200 * 1024;
const JS_THRESHOLD_BYTES = 300 * 1024;

function isThirdParty(url: string, firstPartyDomain?: string): boolean {
  if (!firstPartyDomain) {
    return false;
  }

  try {
    const host = new URL(url).hostname;
    return host !== firstPartyDomain && !host.endsWith(`.${firstPartyDomain}`);
  } catch {
    return false;
  }
}

export function buildSuggestions(
  resourceImpacts: ResourceImpact[],
  firstPartyDomain?: string,
): DeveloperSuggestion[] {
  const suggestions: DeveloperSuggestion[] = [];
  const seen = new Set<string>();

  for (const resource of resourceImpacts) {
    const type = resource.resourceType ?? '';
    const lowerUrl = resource.url.toLowerCase();

    const looksLikeImage =
      type === 'image' || /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(lowerUrl);
    if (looksLikeImage && resource.networkBytes > IMAGE_THRESHOLD_BYTES) {
      const key = `image:${resource.url}`;
      if (!seen.has(key)) {
        suggestions.push({
          rule: 'image-compression',
          message: `Compress large image (${Math.round(resource.networkBytes / 1024)}KB) using WebP or AVIF.`,
          resourceUrl: resource.url,
        });
        seen.add(key);
      }
    }

    const looksLikeJs = type === 'script' || /\.m?js(\?|$)/i.test(lowerUrl);
    if (looksLikeJs && resource.networkBytes > JS_THRESHOLD_BYTES) {
      const key = `js:${resource.url}`;
      if (!seen.has(key)) {
        suggestions.push({
          rule: 'js-splitting',
          message: `Split large JavaScript bundle (${Math.round(resource.networkBytes / 1024)}KB) for faster incremental loading.`,
          resourceUrl: resource.url,
        });
        seen.add(key);
      }
    }

    if (isThirdParty(resource.url, firstPartyDomain)) {
      const key = `thirdparty:${new URL(resource.url).hostname}`;
      if (!seen.has(key)) {
        suggestions.push({
          rule: 'third-party-review',
          message: `Review third-party resource usage from ${new URL(resource.url).hostname}.`,
          resourceUrl: resource.url,
        });
        seen.add(key);
      }
    }
  }

  return suggestions;
}

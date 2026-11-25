import { VideoProviderKind } from "@/types/video";

const YOUTUBE_HOSTS = ["youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com"];
const INSTAGRAM_HOSTS = ["instagram.com", "www.instagram.com"];
const VIMEO_HOSTS = ["vimeo.com", "player.vimeo.com"];
const TIKTOK_HOSTS = ["tiktok.com", "www.tiktok.com", "vt.tiktok.com", "vm.tiktok.com"];
const DAILYMOTION_HOSTS = ["dailymotion.com", "www.dailymotion.com", "geo.dailymotion.com"];
const WISTIA_HOSTS = [
  "wistia.com",
  "www.wistia.com",
  "fast.wistia.com",
  "fast.wistia.net",
  "home.wistia.com",
];

/**
 * Detects the playback provider from a submitted URL.
 * Detection never decides playability — embedding restrictions are handled
 * at render time with an explicit fallback state.
 */
export function detectVideoProvider(url: string): VideoProviderKind {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "unsupported";
  }
  if (!/^https?:$/.test(parsed.protocol)) return "unsupported";

  const host = parsed.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.includes(host)) return "youtube";
  if (INSTAGRAM_HOSTS.includes(host)) return "instagram";
  if (VIMEO_HOSTS.includes(host)) return "vimeo";
  if (TIKTOK_HOSTS.includes(host)) return "tiktok";
  if (DAILYMOTION_HOSTS.includes(host)) return "dailymotion";
  if (WISTIA_HOSTS.includes(host)) return "wistia";
  return "external";
}

/** Extracts the YouTube video id from watch/shorts/youtu.be/embed URLs. */
export function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") {
      return parsed.pathname.slice(1).split("/")[0] || null;
    }
    const vParam = parsed.searchParams.get("v");
    if (vParam) return vParam;
    const segments = parsed.pathname.split("/").filter(Boolean);
    const marker = segments.findIndex((s) => s === "shorts" || s === "embed" || s === "live");
    const candidate = marker >= 0 ? segments[marker + 1] : undefined;
    if (candidate) return candidate;
    return null;
  } catch {
    return null;
  }
}

/** Extracts the Instagram shortcode from post/reel/tv URLs. */
export function extractInstagramCode(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const marker = segments.findIndex((s) => s === "p" || s === "reel" || s === "tv");
    const candidate = marker >= 0 ? segments[marker + 1] : undefined;
    if (candidate) return candidate;
    return null;
  } catch {
    return null;
  }
}

export function youTubeEmbedUrl(
  videoId: string,
  options: { autoplay?: boolean; mute?: boolean; loop?: boolean } = {},
): string {
  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
  });
  if (options.autoplay) params.set("autoplay", "1");
  if (options.mute) params.set("mute", "1");
  if (options.loop) {
    params.set("loop", "1");
    params.set("playlist", videoId);
  }
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

export function instagramEmbedUrl(code: string): string {
  return `https://www.instagram.com/p/${code}/embed`;
}

export function vimeoEmbedUrl(
  videoId: string,
  options: { autoplay?: boolean; title?: boolean; byline?: boolean } = {},
): string {
  const params = new URLSearchParams({ title: "0", byline: "0", portrait: "0" });
  if (options.autoplay) params.set("autoplay", "1");
  if (options.title) params.set("title", "1");
  if (options.byline) params.set("byline", "1");
  return `https://player.vimeo.com/video/${videoId}?${params.toString()}`;
}

export function dailymotionEmbedUrl(videoId: string): string {
  return `https://www.dailymotion.com/embed/video/${videoId}`;
}

/** Extracts a Wistia hashed media id from any Wistia URL. */
export function extractWistiaId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const m =
      parsed.pathname.match(/\/(?:embed\/iframe|medias)\/([a-z0-9]{6,})/i) ||
      parsed.pathname.match(/^\/([a-z0-9]{8,})$/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export function wistiaEmbedUrl(mediaId: string): string {
  return `https://fast.wistia.net/embed/iframe/${encodeURIComponent(mediaId)}?seo=true&videoFoam=true`;
}

/**
 * Binance Academy beginner-track lessons are served by Wistia. Some catalog
 * entries have no source_url, so resolve the official Wistia media id from the
 * lesson/video id or title. IDs verified via Wistia oEmbed and the live
 * Binance lesson page (which embeds fast.wistia.net/embed/iframe/<id>).
 */
const BINANCE_WISTIA_BY_ID: Record<string, string> = {
  // Introduction to Blockchain Technology (Beginner track / Blockchain Fundamentals)
  "b5d20007-2256-4761-977d-630b92772f62": "wd7sex2q3c",
};

const BINANCE_WISTIA_BY_TITLE: Array<[RegExp, string]> = [
  [/introduction to blockchain technology|مقدمة إلى تكنولوجيا البلوكشين|أساسيات سلاسل البلوكشين/i, "wd7sex2q3c"],
];

export function resolveWistiaMediaId(video: {
  id: string;
  title?: string;
  sourceUrl?: string;
  providerRaw?: string;
}): string | null {
  const direct = extractWistiaId(video.sourceUrl || "");
  if (direct) return direct;
  const mapped = BINANCE_WISTIA_BY_ID[video.id];
  if (mapped) return mapped;
  const title = video.title || "";
  for (const [pattern, id] of BINANCE_WISTIA_BY_TITLE) {
    if (pattern.test(title)) return id;
  }
  return null;
}

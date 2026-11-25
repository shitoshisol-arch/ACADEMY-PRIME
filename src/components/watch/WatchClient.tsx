"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, getAccessToken, type HeartbeatResult, type PlaylistItem } from "@/lib/api";
import type { CatalogVideo } from "@/types/video";
import {
  youTubeEmbedUrl,
  vimeoEmbedUrl,
  dailymotionEmbedUrl,
  wistiaEmbedUrl,
} from "@/lib/videoProviders";

type YTPlayer = {
  getCurrentTime: () => number;
  getPlayerState: () => number;
};

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: Record<string, unknown>,
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT as YTNamespace);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return ytApiPromise;
}

type WistiaPlayer = {
  time(): number;
  duration(): number;
  state(): string;
  bind(event: string, cb: (time: number) => void): void;
  unbind(event: string, cb: (time: number) => void): void;
};

declare global {
  interface Window {
    Wistia?: {
      api(matcher: string): WistiaPlayer | null;
    };
    _wq?: unknown[];
  }
}

let wistiaApiPromise: Promise<void> | null = null;
function loadWistiaApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Wistia?.api) return Promise.resolve();
  if (wistiaApiPromise) return wistiaApiPromise;
  wistiaApiPromise = new Promise<void>((resolve) => {
    window._wq = window._wq || [];
    window._wq.push(() => resolve());
    const script = document.createElement("script");
    script.src = "https://fast.wistia.com/assets/external/E-v1.js";
    script.async = true;
    document.head.appendChild(script);
  });
  return wistiaApiPromise;
}

const AR = {
  loginToEarn: "سجّل الدخول لتسجيل تقدمك وكسب المكافأة.",
  completed: "تم إكمال الدرس",
  rewardEligible: "المكافأة مستحقة",
  progress: "التقدم",
  rewardLabel: "المكافأة",
  requiredWatch: "المطلوب للمكافأة",
  viewDashboard: "عرض مكافآتك",
  cannotEmbed: "لا يمكن تضمين هذا الفيديو هنا. لا يسمح مزوّد الفيديو حالياً بتشغيل هذا المحتوى داخل أكاديمي برايم.",
  openSource: "فتح مصدر الفيديو",
  playlistTitle: "محتوى الدورة",
  moduleLabel: "الوحدة",
  nextLesson: "الدرس التالي ←",
  prevLesson: "← الدرس السابق",
  totalLabel: "المدة الإجمالية",
};

const EN = {
  loginToEarn: "Log in to track your progress and earn the reward.",
  completed: "LESSON COMPLETED",
  rewardEligible: "REWARD ELIGIBLE",
  progress: "Progress",
  rewardLabel: "Reward",
  requiredWatch: "Required for reward",
  viewDashboard: "View your rewards",
  cannotEmbed:
    "This video cannot be embedded here. The video provider does not currently allow this content to be played inside ACADEMY PRIME.",
  openSource: "Open Video Source",
  playlistTitle: "Course contents",
  moduleLabel: "Module",
  nextLesson: "Next lesson →",
  prevLesson: "← Previous lesson",
  totalLabel: "Total duration",
};

export function WatchClient({ video, locale }: { video: CatalogVideo; locale: string }) {
  const copy = locale === "ar" ? AR : EN;
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [result, setResult] = useState<HeartbeatResult | null>(null);
  const [earned, setEarned] = useState(false);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [redirecting, setRedirecting] = useState(false);
  const redirectRef = useRef(false);
  const router = useRouter();

  const courseTag =
    (video?.tags ?? []).find(
      (tag) => !/^(module-|wistia-|author:)/.test(tag) && /^[a-z0-9-]+$/.test(tag),
    ) ?? null;

  useEffect(() => {
    if (!courseTag) {
      setPlaylist([]);
      return;
    }
    let cancelled = false;
    api
      .getPlaylist(courseTag)
      .then((items) => {
        if (!cancelled) setPlaylist(items);
      })
      .catch(() => {
        if (!cancelled) setPlaylist([]);
      });
    return () => {
      cancelled = true;
    };
  }, [courseTag]);

  // A Binance Academy course URL is a webpage, not a playable video. If we
  // already imported that track as a playlist, open module 1 instead of
  // showing the "cannot embed" fallback.
  useEffect(() => {
    if (redirectRef.current) return;
    const track = (video.sourceUrl || "").match(
      /binance\.com\/[^?]*\/academy\/courses\/track\/([a-z0-9-]+)/i,
    )?.[1];
    if (!track) return;
    let cancelled = false;
    redirectRef.current = true;
    setRedirecting(true);
    api
      .getPlaylist(track)
      .then((items) => {
        const first = items[0];
        if (cancelled || !first || items.length < 2 || first.id === video.id) {
          redirectRef.current = false;
          setRedirecting(false);
          return;
        }
        router.replace(`/${locale}/watch/${first.id}`);
      })
      .catch(() => {
        if (!cancelled) {
          redirectRef.current = false;
          setRedirecting(false);
        }
      });
  }, [video.provider, video.sourceUrl, locale, router]);

  const playerRef = useRef<YTPlayer | null>(null);
  const fallbackSeconds = useRef(0);

  useEffect(() => setAuthed(Boolean(getAccessToken())), []);

  const sendHeartbeat = useCallback(
    async (position: number, ended = false) => {
      try {
        const res = await api.heartbeat({
          video_id: video.id,
          position_seconds: Math.floor(position),
          state: "playing",
          ended,
        });
        setResult(res);
        if (res.reward_issued) setEarned(true);
      } catch {
        /* transient errors ignored; the next beat retries */
      }
    },
    [video.id],
  );

  // YouTube interactive player — real playback events drive heartbeats.
  useEffect(() => {
    if (!video || video.provider !== "youtube" || !video.providerVideoId || !authed)
      return;

    let interval: number | null = null;
    let cancelled = false;

    loadYouTubeApi().then((YT) => {
      if (cancelled) return;
      const mount = document.getElementById("ap-yt-player");
      if (!mount) return;
      playerRef.current = new YT.Player(mount, {
        videoId: video.providerVideoId as string,
        playerVars: { modestbranding: 1, rel: 0 },
        events: {
          onStateChange: (event: { data: number }) => {
            const state = event.data;
            if (state === 1 && interval === null) {
              interval = window.setInterval(() => {
                const p = playerRef.current;
                if (p) void sendHeartbeat(p.getCurrentTime());
              }, 10000);
            }
            if (state !== 1 && interval !== null) {
              window.clearInterval(interval);
              interval = null;
            }
            if (state === 0) {
              const p = playerRef.current;
              if (p) void sendHeartbeat(p.getCurrentTime(), true);
            }
          },
        },
      }) as unknown as YTPlayer;
    });

    return () => {
      cancelled = true;
      if (interval !== null) window.clearInterval(interval);
    };
  }, [video, authed, sendHeartbeat]);

  // Wistia (official E-v1.js player API) — real playback time drives the same
  // heartbeats, so the existing 90% completion + reward rules are unchanged.
  useEffect(() => {
    if (!video || video.provider !== "wistia" || !video.providerVideoId || !authed)
      return;

    let cancelled = false;
    let initConfig: { id: string; onReady: (v: WistiaPlayer) => void } | null = null;
    let cleanups: Array<() => void> = [];

    loadWistiaApi()
      .then(() => {
        if (cancelled) return;
        const id = video.providerVideoId as string;
        const onReady = (player: WistiaPlayer) => {
          if (cancelled) return;
          let lastBeat = 0;
          const beat = (ended = false) => void sendHeartbeat(player.time(), ended);

          const onPlay = () => {
            lastBeat = 0;
          };
          const onTime = (t: number) => {
            if (player.state() !== "playing") return;
            if (t - lastBeat >= 10) {
              lastBeat = t;
              beat();
            }
          };
          const onEnd = () => {
            beat(true);
          };

          player.bind("play", onPlay);
          player.bind("timechange", onTime);
          player.bind("end", onEnd);
          cleanups = [
            () => player.unbind("play", onPlay),
            () => player.unbind("timechange", onTime),
            () => player.unbind("end", onEnd),
          ];
        };
        initConfig = { id, onReady };
        window._wq!.push(initConfig);
      })
      .catch(() => {
        /* transient script failure; no heartbeat until the player loads */
      });

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
      if (initConfig) window._wq?.push({ revoke: initConfig });
    };
  }, [video.provider, video.providerVideoId, authed, sendHeartbeat]);

  // Fallback for providers without playback APIs: count visible wall-clock
  // seconds while the page is open and beat every 10s.
  useEffect(() => {
    if (
      !video ||
      video.provider === "youtube" ||
      video.provider === "wistia" ||
      !authed ||
      authed === null
    )
      return;
    fallbackSeconds.current = result?.max_position_seconds ?? 0;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        fallbackSeconds.current += 1;
        if (fallbackSeconds.current % 10 === 0) {
          void sendHeartbeat(fallbackSeconds.current);
        }
      }
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id, authed]);

  const pct = Number(result?.current_percentage ?? 0);
  const required = video.requiredWatchPercentage || 85;
  const completed = earned || Boolean(result?.completed);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
      <div className="min-w-0">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl2 bg-ink-950 shadow-elevated">
        {video.provider === "youtube" && video.providerVideoId ? (
          <div id="ap-yt-player" className="absolute inset-0 h-full w-full" />
        ) : video.provider === "wistia" && video.providerVideoId ? (
          <iframe
            src={wistiaEmbedUrl(video.providerVideoId)}
            title={video.title}
            allow="autoplay; fullscreen"
            allowTransparency
            frameBorder={0}
            scrolling="no"
            className="wistia_embed absolute inset-0 h-full w-full"
            name="wistia_embed"
          />
        ) : video.provider === "vimeo" && video.providerVideoId ? (
          <iframe
            src={vimeoEmbedUrl(video.providerVideoId)}
            title={video.title}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        ) : video.provider === "dailymotion" && video.providerVideoId ? (
          <iframe
            src={dailymotionEmbedUrl(video.providerVideoId)}
            title={video.title}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
            {redirecting ? (
              <p className="max-w-sm text-sm leading-relaxed text-paper-100/80">
                {locale === "ar" ? "جارٍ فتح الدورة كاملة…" : "Opening the full course…"}
              </p>
            ) : (
            <>
            <p className="max-w-sm text-sm leading-relaxed text-paper-100/70">{copy.cannotEmbed}</p>
            <a
              href={video.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-brass-400 px-5 py-2 text-xs font-semibold text-ink-950"
            >
              {copy.openSource} ↗
            </a>
            </>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 rounded-xl2 border border-line bg-white p-6 shadow-card md:p-8">
        <h1 className="font-display text-2xl leading-snug md:text-3xl">{video.title}</h1>
        {video.description && (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-500">{video.description}</p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-ink-500">
          <span className="rounded-full border border-line px-3 py-1 capitalize">{video.difficulty}</span>
          {video.durationSeconds > 0 && (
            <span className="rounded-full border border-line px-3 py-1">
              {`${String(Math.floor(video.durationSeconds / 60)).padStart(2, "0")}:${String(video.durationSeconds % 60).padStart(2, "0")}`}
            </span>
          )}
          <span className="rounded-full border border-emerald-600/30 bg-emerald-500/10 px-3 py-1 font-semibold text-emerald-700">
            ⬡ {video.reward} ACAD-P
          </span>
        </div>

        {/* Progress + completion states */}
        <div className="mt-7 border-t border-line pt-6">
          {completed ? (
            <div className="rounded-lg border border-emerald-600/30 bg-emerald-500/10 p-4 text-center">
              <p className="font-display text-lg tracking-wide text-emerald-700">✓ {copy.completed}</p>
              <p className="mt-1 text-sm font-semibold text-emerald-700">⬡ {copy.rewardEligible} · {video.reward} ACAD-P</p>
              <Link
                href={`/${locale}/dashboard`}
                className="mt-3 inline-flex rounded-full bg-ink-950 px-5 py-2 text-xs font-semibold text-paper-50"
              >
                {copy.viewDashboard}
              </Link>
            </div>
          ) : (
            <>
              <div className="flex items-end justify-between">
                <span className="text-sm font-medium text-ink-500">{copy.progress}</span>
                <span className="font-display text-2xl text-ink-950">{pct.toFixed(0)}%</span>
              </div>
              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-paper-200">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-brass-400 transition-all duration-500"
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-ink-300">
                {copy.requiredWatch}: {required}%
              </p>
              {authed === false && (
                <p className="mt-4 rounded-lg border border-brass-400/40 bg-brass-400/10 p-3 text-center text-xs font-medium text-brass-600">
                  <Link href={`/${locale}/login`} className="underline">
                    {copy.loginToEarn}
                  </Link>
                </p>
              )}
            </>
          )}
        </div>
      </div>
      </div>

      {playlist.length > 0 && (() => {
        const currentIndex = playlist.findIndex((item) => item.id === video.id);
        const prev = currentIndex > 0 ? playlist[currentIndex - 1] : null;
        const next =
          currentIndex >= 0 && currentIndex < playlist.length - 1
            ? playlist[currentIndex + 1]
            : null;
        const total = playlist.reduce((sum, item) => sum + (item.duration_seconds || 0), 0);
        const fmt = (seconds: number) =>
          `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
        return (
          <aside className="h-fit overflow-hidden rounded-xl2 border border-line bg-white shadow-card lg:sticky lg:top-6">
            <div className="bg-ink-950 p-4 text-paper-50">
              <p className="font-display text-sm">{copy.playlistTitle}</p>
              <p className="mt-1 text-xs text-paper-100/60">
                {playlist.length} {copy.moduleLabel} · {copy.totalLabel} {fmt(total)}
              </p>
            </div>
            <div className="max-h-[520px] overflow-y-auto">
              {playlist.map((item, index) => {
                const active = item.id === video.id;
                return (
                  <Link
                    key={item.id}
                    href={`/${locale}/watch/${item.id}`}
                    className={`flex items-center gap-3 border-b border-line/70 px-4 py-3 text-xs transition-colors ${
                      active
                        ? "bg-brass-400/15 font-semibold text-ink-950"
                        : "text-ink-600 hover:bg-paper-50"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        active ? "bg-brass-400 text-ink-950" : "bg-paper-200 text-ink-500"
                      }`}
                    >
                      {item.module ?? index + 1}
                    </span>
                    <span className="flex-1 leading-snug">{item.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-400">
                      {fmt(item.duration_seconds || 0)}
                    </span>
                  </Link>
                );
              })}
            </div>
            {(prev || next) && (
              <div className="flex items-center justify-between gap-2 border-t border-line p-3">
                {prev ? (
                  <Link
                    href={`/${locale}/watch/${prev.id}`}
                    className="rounded-full bg-paper-100 px-3 py-1.5 text-[11px] font-semibold text-ink-700 hover:bg-paper-200"
                  >
                    {copy.prevLesson}
                  </Link>
                ) : (
                  <span />
                )}
                {next ? (
                  <Link
                    href={`/${locale}/watch/${next.id}`}
                    className="rounded-full bg-ink-950 px-3 py-1.5 text-[11px] font-semibold text-paper-50"
                  >
                    {copy.nextLesson}
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            )}
          </aside>
        );
      })()}
    </div>
  );
}

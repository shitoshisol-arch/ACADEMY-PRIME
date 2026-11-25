"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Track = {
  tag: string;
  title: string;
  title_ar?: string | null;
  title_en?: string | null;
  cover_url?: string | null;
  video_count: number;
  total_duration: number;
  first_video_id: string;
  language: string | null;
};

const fmt = (seconds: number) =>
  `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

export function TrackCourses({ locale }: { locale: string }) {
  const [tracks, setTracks] = useState<Track[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .listPlaylists()
      .then((items) => {
        if (!cancelled) setTracks(items);
      })
      .catch(() => {
        if (!cancelled) setTracks([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (tracks.length === 0) return null;

  return (
    <section className="mt-14">
      <h2 className="font-display text-2xl text-ink-950">
        {locale === "ar" ? "دورات المسارات الكاملة" : "Full track courses"}
      </h2>
      <p className="mt-2 text-sm text-ink-500">
        {locale === "ar"
          ? "كل مسار مقسّم إلى دروس، افتح الدرس الأول لعرض الدورة كاملة."
          : "Each track is split into lessons — open the first one to see the full course."}
      </p>
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {tracks.map((track) => (
          <Link
            key={track.tag}
            href={`/${locale}/watch/${track.first_video_id}`}
            className="group overflow-hidden rounded-xl2 border border-line bg-white p-6 shadow-card transition-shadow hover:shadow-elevated"
          >
            {track.cover_url ? (
              <div className="-mx-6 -mt-6 mb-5 h-36 overflow-hidden rounded-t-xl2 bg-ink-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={track.cover_url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                />
              </div>
            ) : (
              <span className="inline-flex rounded-full bg-brass-400/15 px-3 py-1 text-[11px] font-semibold text-brass-600">
                {track.language === "ar" ? "العربية" : "English"}
              </span>
            )}
            <h3 className="mt-4 font-display text-lg leading-snug text-ink-950 group-hover:text-brass-600">
              {locale === "ar"
                ? track.title_ar || track.title
                : track.title_en || track.title}
            </h3>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-xs text-ink-500">
              <span>
                {track.video_count} {locale === "ar" ? "درس" : "lessons"}
              </span>
              <span className="font-mono">{fmt(track.total_duration)}</span>
            </div>
            <span className="mt-3 block text-xs font-semibold text-brass-600">
              {locale === "ar" ? "ابدأ الدورة ←" : "Start course →"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

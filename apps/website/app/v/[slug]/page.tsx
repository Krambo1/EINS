import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CALENDLY_URL, CONTACT_EMAIL, VIDEO_API_ORIGIN } from "@/lib/constants";
import { WatchPlayer } from "./watch-player";

/**
 * eins.ag/v/<slug> · personal video page for one Praxis.
 *
 * The video, its metadata and the view tracking live in the portal (admin
 * upload, Postgres, R2). This page only renders: it asks the portal's public
 * API for the video on every request (the playback URL is presigned and
 * expires, so nothing here may be cached) and the player sends cookieless
 * beacons straight back to the portal.
 */

export const dynamic = "force-dynamic";

interface PublicVideo {
  slug: string;
  praxisName: string;
  title: string | null;
  message: string | null;
  durationSeconds: number | null;
  contentType: string;
  videoUrl: string;
  posterUrl: string | null;
}

const SLUG_PATTERN = /^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;

async function loadVideo(slug: string): Promise<PublicVideo | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  const res = await fetch(`${VIDEO_API_ORIGIN}/api/public/videos/${slug}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`video api ${res.status}`);
  return (await res.json()) as PublicVideo;
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const video = await loadVideo(params.slug).catch(() => null);
  return {
    title: video ? `Video für ${video.praxisName}` : "Video",
    robots: { index: false, follow: false },
    alternates: { canonical: null },
  };
}

export default async function VideoPage({ params }: { params: { slug: string } }) {
  const video = await loadVideo(params.slug);
  if (!video) notFound();

  return (
    <main className="min-h-dvh bg-bg-primary">
      <header className="container flex max-w-4xl items-center py-6 md:py-10">
        <Link href="/" aria-label="EINS">
          <Image
            src="/eins-logo.svg"
            alt="EINS"
            width={600}
            height={240}
            priority
            className="h-9 w-auto md:h-10"
          />
        </Link>
      </header>

      <section className="container max-w-4xl pb-16 md:pb-24">
        <p className="text-base text-fg-secondary md:text-lg">Für {video.praxisName}</p>
        <h1 className="display-m mt-2">{video.title ?? "Ihre persönliche Video-Analyse"}</h1>
        {video.message && (
          <p className="mt-5 max-w-prose whitespace-pre-line text-lg leading-relaxed text-fg-primary md:text-xl">
            {video.message}
          </p>
        )}

        <WatchPlayer
          slug={video.slug}
          apiOrigin={VIDEO_API_ORIGIN}
          videoUrl={video.videoUrl}
          posterUrl={video.posterUrl}
          contentType={video.contentType}
          calendlyUrl={CALENDLY_URL}
        />

        <div className="mt-12 flex items-center gap-4 border-t border-border pt-8">
          <Image
            src="/headshot.webp"
            alt="Karam Issa"
            width={112}
            height={112}
            className="h-14 w-14 rounded-full object-cover"
          />
          <div className="text-base leading-snug">
            <p className="font-medium text-fg-primary">Karam Issa, Gründer von EINS</p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-fg-secondary underline-offset-4 hover:text-fg-primary hover:underline"
            >
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </section>

      <footer className="container flex max-w-4xl gap-6 pb-10 text-sm text-fg-secondary">
        <Link href="/impressum" className="hover:text-fg-primary">
          Impressum
        </Link>
        <Link href="/datenschutz" className="hover:text-fg-primary">
          Datenschutz
        </Link>
      </footer>
    </main>
  );
}

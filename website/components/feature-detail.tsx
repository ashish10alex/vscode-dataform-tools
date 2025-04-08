"use client";

import { useState } from "react";
import { ArrowLeft, Play } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

interface FeatureDetailProps {
  id: string
  title: string
  description: string
  videoUrl: string
  thumbnail: string
  longDescription?: string
}

export default function FeatureDetail({
  id,
  title,
  description,
  videoUrl,
  thumbnail,
  longDescription,
}: FeatureDetailProps) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="container py-8">
      <Button variant="ghost" asChild className="mb-6">
        <Link href="/" className="flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to all features
        </Link>
      </Button>

      <h1 className="mb-4 text-3xl font-bold">{title}</h1>
      <p className="mb-8 text-lg text-muted-foreground">{description}</p>

      <div className="relative mb-8 aspect-video w-full overflow-hidden rounded-lg bg-muted">
        {playing ? (
          <video
            src={videoUrl}
            className="h-full w-full object-cover"
            autoPlay
            controls
            onEnded={() => setPlaying(false)}
          />
        ) : (
          <>
            <img src={thumbnail || "/placeholder.svg"} alt={title} className="h-full w-full object-cover" />
            <button
              onClick={() => setPlaying(true)}
              className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity hover:bg-black/40"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90">
                <Play className="h-6 w-6 fill-current text-black" />
              </div>
            </button>
          </>
        )}
      </div>

      {longDescription && (
        <div className="prose prose-gray max-w-none">
          <div dangerouslySetInnerHTML={{ __html: longDescription }} />
        </div>
      )}
    </div>
  );
}

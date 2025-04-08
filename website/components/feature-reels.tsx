"use client";

import { useState } from "react";
import { Play } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Feature {
  id: string
  title: string
  description: string
  videoUrl: string
  videoId: string
  thumbnail: string
}

export default function FeatureReels() {
  const [playing, setPlaying] = useState<Record<string, boolean>>({});

  const features: Feature[] = [
    {
      id: "compile-sql",
      title: "Installation and features",
      description: "Compile your SQLX files to SQL with a single click. View the compiled SQL directly in VSCode.",
      videoUrl: "https://youtu.be/nb_OFh6YgOc?si=OO0Lsa7IpAUvlvJn",
      videoId: "nb_OFh6YgOc",
      thumbnail: "https://img.youtube.com/vi/nb_OFh6YgOc/maxresdefault.jpg",
    },
    {
      id: "schema-explorer",
      title: "Windows installation",
      description: "Windows installation",
      videoUrl: "https://youtu.be/8AsSwzmzhV4?si=QOPmqpvwGmQEIy96",
      videoId: "8AsSwzmzhV4",
      thumbnail: "https://img.youtube.com/vi/8AsSwzmzhV4/maxresdefault.jpg",
    },
  ];

  const togglePlay = (id: string) => {
    setPlaying((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <div className="grid gap-8">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-7xl mx-auto w-full">
        {features.map((feature) => (
          <Card key={feature.id} className="overflow-hidden">
            <div className="relative aspect-video bg-muted">
              {playing[feature.id] ? (
                <iframe
                  src={`https://www.youtube.com/embed/${feature.videoId}?autoplay=1&rel=0`}
                  className="absolute inset-0 h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <>
                  <img
                    src={feature.thumbnail || "/placeholder.svg"}
                    alt={feature.title}
                    className="h-full w-full object-cover"
                  />
                  <button
                    onClick={() => togglePlay(feature.id)}
                    className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity hover:bg-black/40"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90">
                      <Play className="h-5 w-5 fill-current text-black" />
                    </div>
                  </button>
                </>
              )}
            </div>
            <CardHeader>
              <CardTitle>{feature.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-sm text-muted-foreground">{feature.description}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

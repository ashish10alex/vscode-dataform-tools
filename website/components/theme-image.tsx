"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

interface ThemeImageProps {
  lightSrc: string;
  darkSrc: string;
  alt: string;
  className?: string;
  width: number;
  height: number;
}

export function ThemeImage({ 
  lightSrc, 
  darkSrc, 
  alt, 
  className,
  width,
  height 
}: ThemeImageProps) {
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  
  // After hydration, we can show the theme-dependent image
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // Use dark image during server rendering to match the first client render
  // Only switch to theme-aware image after hydration is complete
  const src = !mounted ? darkSrc : (resolvedTheme === "light" ? lightSrc : darkSrc);
  
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      width={width}
      height={height}
    />
  );
} 
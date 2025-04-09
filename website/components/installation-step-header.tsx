"use client";
import React from "react";

interface InstallationStepHeaderProps {
  number: number;
  title: string;
  link?: string;
  isOptional?: boolean;
}

export function InstallationStepHeader({ 
  number, 
  title, 
  link, 
  isOptional = false 
}: InstallationStepHeaderProps) {
  const content = (
    <>
      <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-primary/10 text-primary text-sm">
        {number}
      </span>
      {link ? (
        <a href={link} className="hover:underline">
          {title}
        </a>
      ) : (
        title
      )}
      {isOptional && (
        <span className="text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5 dark:bg-gray-700 dark:text-gray-300">
          Optional
        </span>
      )}
    </>
  );

  return (
    <h2 className="text-xl font-semibold tracking-tight mb-4 flex items-center gap-2 dark:text-white">
      {content}
    </h2>
  );
} 
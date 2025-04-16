'use client';

import React from 'react';
import { BlogContent } from './BlogContent';

interface ClientBlogContentProps {
  content: string;
}

export function ClientBlogContent({ content }: ClientBlogContentProps) {
  return <BlogContent content={content} />;
} 
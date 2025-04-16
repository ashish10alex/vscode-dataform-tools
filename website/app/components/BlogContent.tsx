'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import bash from 'highlight.js/lib/languages/bash';

interface BlogContentProps {
  content: string;
}

export function BlogContent({ content }: BlogContentProps) {
  return (
    <ReactMarkdown
      rehypePlugins={[() => rehypeHighlight({ languages: { bash } })]}
      components={{
        pre: ({ node, ...props }) => (
          <pre className="w-full overflow-x-auto my-6" {...props} />
        ),
        code: ({ node, ...props }) => (
          <code className="rounded-md" {...props} />
        )
      }}
    >
      {content}
    </ReactMarkdown>
  );
} 
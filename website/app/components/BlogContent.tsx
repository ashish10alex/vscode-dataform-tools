'use client';

import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import bash from 'highlight.js/lib/languages/bash';
import './admonitions.css';

interface BlogContentProps {
  content: string;
}

// Custom function to handle GitHub-style admonitions
const transformGithubAdmonitions = (content: string): string => {
  // Define the admonition types we want to handle
  const admonitionTypes = ['NOTE', 'TIP', 'WARNING', 'IMPORTANT'];
  
  // Regular expression to match GitHub-style admonitions
  // Example: > [!TIP]
  const admonitionRegex = new RegExp(
    `> \\[!(${admonitionTypes.join('|')})\\]\\n((?:> .*\\n)+)`,
    'g'
  );
  
  // Transform GitHub-style admonitions to HTML
  return content.replace(admonitionRegex, (match, type, content) => {
    // Clean up the content lines (remove the leading '> ')
    const cleanContent = content
      .split('\n')
      .map(line => line.startsWith('> ') ? line.substring(2) : line)
      .join('\n')
      .trim();
    
    // Generate HTML for the admonition
    return `<div class="admonition admonition-${type.toLowerCase()}">
      <div class="admonition-heading">
        <span class="admonition-icon">${getAdmonitionIcon(type)}</span>
        ${type}
      </div>
      <div class="admonition-content">
        <p>${cleanContent}</p>
      </div>
    </div>`;
  });
};

// Helper function to get the icon for a given admonition type
const getAdmonitionIcon = (type: string): string => {
  switch (type.toUpperCase()) {
    case 'TIP':
      return '💡';
    case 'NOTE':
      return 'ℹ️';
    case 'WARNING':
      return '⚠️';
    case 'IMPORTANT':
      return '❗';
    default:
      return '';
  }
};

export function BlogContent({ content }: BlogContentProps) {
  const [processedContent, setProcessedContent] = useState(content);
  
  useEffect(() => {
    // Process the content on the client side
    setProcessedContent(transformGithubAdmonitions(content));
  }, [content]);
  
  return (
    <div>
      <ReactMarkdown
        rehypePlugins={[rehypeRaw, () => rehypeHighlight({ languages: { bash } })]}
        components={{
          pre: ({ node, ...props }) => (
            <pre className="w-full overflow-x-auto my-6" {...props} />
          ),
          code: ({ node, ...props }) => (
            <code className="rounded-md" {...props} />
          )
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
} 
import React from 'react';
import { 
  ChevronRight, 
  Play, 
  Network, 
  Eye, 
  AlignLeft
} from 'lucide-react';

interface SkeletonLoaderProps {
  type?: 'default' | 'config';
}

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({ type = 'default' }) => {
  if (type === 'config') {
    return (
      <div className="animate-pulse space-y-6">
        <div className="flex items-center space-x-2">
            <div className="h-8 bg-[var(--vscode-widget-border)] rounded w-1/4 opacity-20"></div>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="h-24 bg-[var(--vscode-widget-border)] rounded-lg opacity-10"></div>
            <div className="h-24 bg-[var(--vscode-widget-border)] rounded-lg opacity-10"></div>
          </div>
          <div className="h-48 bg-[var(--vscode-widget-border)] rounded-lg opacity-10"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-pulse space-y-8">
      {/* Model Link Skeleton */}
      <div className="bg-[var(--vscode-sideBar-background)] p-4 rounded-lg border border-[var(--vscode-widget-border)] flex flex-col space-y-2 opacity-40">
        <div className="flex items-center space-x-2">
            <div className="w-4 h-4 rounded bg-[var(--vscode-widget-border)] opacity-30"></div>
            <div className="h-4 bg-[var(--vscode-widget-border)] rounded w-3/4 opacity-30"></div>
        </div>
        <div className="flex items-center space-x-2 pl-6">
            <div className="h-3 bg-[var(--vscode-widget-border)] rounded w-1/2 opacity-20"></div>
        </div>
      </div>

      {/* Lineage Skeleton */}
      <div className="bg-[var(--vscode-sideBar-background)] rounded-lg border border-[var(--vscode-widget-border)] overflow-hidden opacity-60">
        <div className="flex items-center px-4 py-3 border-b border-[var(--vscode-widget-border)]">
          <ChevronRight className="w-4 h-4 mr-2 text-[var(--vscode-descriptionForeground)] opacity-40" />
          <span className="font-semibold text-[var(--vscode-foreground)] opacity-40">Data Lineage</span>
        </div>
      </div>

      {/* Dry Run Skeleton */}
      <div className="bg-[var(--vscode-widget-border)] h-14 rounded border-l-4 border-[var(--vscode-inputValidation-warningBorder)] opacity-10 flex items-center px-4">
          <div className="w-5 h-5 rounded-full bg-[var(--vscode-foreground)] opacity-20 mr-3"></div>
          <div className="h-4 bg-[var(--vscode-foreground)] rounded w-1/3 opacity-20"></div>
      </div>

      {/* Toolbar Skeleton */}
      <div className="bg-[var(--vscode-sideBar-background)] p-4 rounded-lg border border-[var(--vscode-widget-border)] space-y-6 opacity-60">
        <div className="flex flex-wrap items-center gap-2">
          <div className="h-7 bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] rounded px-3 w-1/3 opacity-30"></div>
          <div className="flex-grow"></div>
          <div className="flex space-x-2">
            <div className="h-8 bg-[var(--vscode-button-secondaryBackground)] rounded w-20 opacity-30 flex items-center justify-center">
                <AlignLeft className="w-3 h-3 mr-1.5 opacity-40" />
            </div>
            <div className="h-8 bg-[var(--vscode-button-secondaryBackground)] rounded w-16 opacity-30 flex items-center justify-center">
                <Eye className="w-3 h-3 mr-1.5 opacity-40" />
            </div>
          </div>
        </div>

        {/* Compiler Overrides Skeleton */}
        <div className="bg-[var(--vscode-sideBar-background)] rounded-lg border border-[var(--vscode-widget-border)] overflow-hidden">
            <div className="flex items-center px-4 py-3 border-b border-[var(--vscode-widget-border)] opacity-40">
                <ChevronRight className="w-4 h-4 mr-2" />
                <span className="font-semibold text-sm">Compiler Overrides</span>
            </div>
        </div>

        {/* Action Buttons Skeleton */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--vscode-widget-border)]">
            <div className="h-9 bg-[var(--vscode-button-secondaryBackground)] rounded w-24 opacity-30 flex items-center px-3">
                <Network className="w-4 h-4 mr-1.5 opacity-40" />
            </div>
            <div className="h-9 bg-[var(--vscode-button-background)] rounded w-32 opacity-30 flex items-center px-3">
                <Eye className="w-4 h-4 mr-1.5 opacity-10" />
            </div>
            <div className="h-9 bg-[var(--vscode-button-background)] rounded w-24 opacity-30 flex items-center px-3">
                <Play className="w-4 h-4 mr-1.5 opacity-10" />
            </div>
            <div className="h-9 bg-[var(--vscode-button-background)] rounded w-28 opacity-30 flex items-center px-3 relative">
                <Play className="w-4 h-4 mr-1.5 opacity-10" />
                <div className="absolute -top-2 -right-2 w-8 h-4 bg-[var(--vscode-statusBarItem-warningBackground)] rounded-full opacity-30"></div>
            </div>
        </div>
      </div>

      {/* Code Block Skeleton */}
      <div className="space-y-3">
        <h3 className="text-[var(--vscode-descriptionForeground)] font-semibold text-sm opacity-40">Query</h3>
        <div className="h-64 bg-[var(--vscode-widget-border)] rounded-lg opacity-10"></div>
      </div>
    </div>
  );
};

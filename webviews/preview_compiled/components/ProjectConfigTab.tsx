import React from 'react';
import { Settings } from 'lucide-react';
import { WebviewMessage } from '../../../src/types';

interface ProjectConfigTabProps {
  state: WebviewMessage;
}

export const ProjectConfigTab: React.FC<ProjectConfigTabProps> = ({ state }) => {
  const { projectConfig, dataformCoreVersion } = state;

  if (!projectConfig) {
    return (
      <div className="flex flex-col items-center justify-center h-64 opacity-50">
        <Settings className="w-12 h-12 mb-4" />
        <p>No project configuration found.</p>
      </div>
    );
  }

  const configItems = [
    { label: 'Warehouse', value: projectConfig.warehouse },
    { label: 'Default Database', value: projectConfig.defaultDatabase },
    { label: 'Default Schema', value: projectConfig.defaultSchema },
    { label: 'Assertion Schema', value: projectConfig.assertionSchema },
    { label: 'Table Prefix', value: projectConfig.tablePrefix },
    { label: 'Default Location', value: projectConfig.defaultLocation },
    { label: 'Dataform Core Version', value: dataformCoreVersion || 'Not specified' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h3 className="text-sm font-semibold mb-4 px-1 flex items-center">
          <Settings className="w-4 h-4 mr-2" />
          General Configuration
        </h3>
        <div className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] rounded-md overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--vscode-sideBar-background)] border-b border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]">
              <tr>
                <th className="px-4 py-2 font-semibold w-1/3">Setting</th>
                <th className="px-4 py-2 font-semibold">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--vscode-widget-border)]">
              {configItems.map((item, index) => (
                <tr key={index} className="hover:bg-[var(--vscode-list-hoverBackground)] transition-colors">
                  <td className="px-4 py-2 text-[var(--vscode-descriptionForeground)]">{item.label}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {item.value || <span className="italic opacity-50">Not set</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {projectConfig.vars && Object.keys(projectConfig.vars).length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-4 px-1 flex items-center">
            <Settings className="w-4 h-4 mr-2" />
            Variables
          </h3>
          <div className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] rounded-md overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--vscode-sideBar-background)] border-b border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]">
                <tr>
                  <th className="px-4 py-2 font-semibold w-1/3">Key</th>
                  <th className="px-4 py-2 font-semibold">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--vscode-widget-border)]">
                {Object.entries(projectConfig.vars).map(([key, value]) => (
                  <tr key={key} className="hover:bg-[var(--vscode-list-hoverBackground)] transition-colors">
                    <td className="px-4 py-2 font-mono text-xs text-[var(--vscode-symbolIcon-variableForeground)]">{key}</td>
                    <td className="px-4 py-2 font-mono text-xs">{String(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

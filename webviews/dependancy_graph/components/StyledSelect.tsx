import React from 'react';
import Select, { Props as SelectProps } from 'react-select';

export interface OptionType {
  value: string;
  label: string;
}

type StyledSelectProps = Omit<SelectProps<OptionType, false>, 'styles'> & {
  width?: string;
};

const StyledSelect: React.FC<StyledSelectProps> = ({ width = 'w-96', ...props }) => {
  return (
    <Select
      {...props}
      className={`${width} max-w-full`}
      classNamePrefix="react-select"
      styles={{
        control: (base, state) => ({
          ...base,
          backgroundColor: 'var(--vscode-input-background)',
          borderRadius: '0.75rem',
          borderColor: state.isFocused ? 'var(--vscode-focusBorder)' : 'var(--vscode-input-border)',
          borderWidth: '2px',
          boxShadow: state.isFocused ? '0 0 0 1px var(--vscode-focusBorder)' : 'none',
          padding: '2px',
          transition: 'all 0.2s ease',
          '&:hover': {
            borderColor: 'var(--vscode-focusBorder)'
          }
        }),
        input: (base) => ({
          ...base,
          color: 'var(--vscode-input-foreground)'
        }),
        placeholder: (base) => ({
          ...base,
          color: 'var(--vscode-input-placeholderForeground)'
        }),
        option: (base, state) => ({
          ...base,
          backgroundColor: state.isFocused ? 'var(--vscode-list-activeSelectionBackground)' : 'var(--vscode-dropdown-background)',
          color: state.isFocused ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-dropdown-foreground)',
          padding: '10px 12px',
          cursor: 'pointer',
          '&:hover': {
            backgroundColor: 'var(--vscode-list-activeSelectionBackground)'
          }
        }),
        menu: (base) => ({
          ...base,
          backgroundColor: 'var(--vscode-dropdown-background)',
          border: '2px solid var(--vscode-dropdown-border)',
          borderRadius: '0.75rem',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
        }),
        singleValue: (base) => ({
          ...base,
          color: 'var(--vscode-input-foreground)'
        }),
        dropdownIndicator: (base, state) => ({
          ...base,
          color: state.isFocused ? 'var(--vscode-focusBorder)' : 'var(--vscode-input-placeholderForeground)',
          '&:hover': {
            color: 'var(--vscode-focusBorder)'
          }
        }),
        clearIndicator: (base) => ({
          ...base,
          color: 'var(--vscode-input-placeholderForeground)',
          '&:hover': {
            color: 'var(--vscode-errorForeground)'
          }
        })
      }}
    />
  );
};

export default StyledSelect; 
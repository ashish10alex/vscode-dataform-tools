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
          backgroundColor: '#1a1a1a',
          borderRadius: '0.75rem',
          borderColor: state.isFocused ? '#3b82f6' : '#374151',
          borderWidth: '2px',
          boxShadow: state.isFocused ? '0 0 0 1px #3b82f6' : 'none',
          padding: '2px',
          transition: 'all 0.2s ease',
          '&:hover': {
            borderColor: '#3b82f6'
          }
        }),
        input: (base) => ({
          ...base,
          color: '#fff'
        }),
        placeholder: (base) => ({
          ...base,
          color: '#6b7280'
        }),
        option: (base, state) => ({
          ...base,
          backgroundColor: state.isFocused ? '#2563eb' : '#1a1a1a',
          color: state.isFocused ? 'white' : '#e5e7eb',
          padding: '10px 12px',
          cursor: 'pointer',
          '&:hover': {
            backgroundColor: '#2563eb'
          }
        }),
        menu: (base) => ({
          ...base,
          backgroundColor: '#1a1a1a',
          border: '2px solid #374151',
          borderRadius: '0.75rem',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
        }),
        singleValue: (base) => ({
          ...base,
          color: '#fff'
        }),
        dropdownIndicator: (base, state) => ({
          ...base,
          color: state.isFocused ? '#3b82f6' : '#6b7280',
          '&:hover': {
            color: '#3b82f6'
          }
        }),
        clearIndicator: (base) => ({
          ...base,
          color: '#6b7280',
          '&:hover': {
            color: '#ef4444'
          }
        })
      }}
    />
  );
};

export default StyledSelect; 
/* eslint-disable react/prop-types */
import { Select } from 'antd';
import React from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
}

export const SortSelect: React.FC<Props> = ({ value, onChange, options }) => (
  <Select
    size="small"
    value={value}
    onChange={onChange}
    options={options}
    className="min-w-[150px]"
  />
);

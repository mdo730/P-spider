/* eslint-disable react/prop-types */
import { DownOutlined, SearchOutlined } from '@ant-design/icons';
import { Input, Popover } from 'antd';
import React, { useMemo, useState } from 'react';
import { MakerLogo } from './MakerLogo';

export interface MakerOption {
  /** 标签名（hpoi 规范名） */
  name: string;
  /** 标签 id */
  id: string;
  /** 本地词条数 */
  count: number;
}

/** 厂商标识按钮 + 点击弹出的浮窗（图标 + 名称 + 词条数，可搜索/排序） */
export const MakerPicker: React.FC<{
  value: string | null;
  options: MakerOption[];
  onChange: (id: string | null) => void;
}> = ({ value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const [sort, setSort] = useState<'count' | 'name'>('count');

  const current = options.find((o) => o.id === value);

  const list = useMemo(() => {
    const q = kw.trim().toLowerCase();
    const arr = q
      ? options.filter((o) => o.name.toLowerCase().includes(q))
      : [...options];
    arr.sort((a, b) =>
      sort === 'count' ? b.count - a.count : a.name.localeCompare(b.name),
    );
    return arr;
  }, [options, kw, sort]);

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  const rowCls = (active: boolean) =>
    `flex w-full items-center gap-2 rounded px-1.5 py-1 text-sm text-left transition-colors ${
      active
        ? 'bg-gray-100 font-medium text-ant-color-primary'
        : 'text-gray-700 hover:bg-gray-100'
    }`;

  const sortBtnCls = (active: boolean) =>
    `rounded px-1.5 py-0.5 text-xs transition-colors ${
      active
        ? 'bg-gray-100 font-medium text-ant-color-primary'
        : 'text-gray-400 hover:bg-gray-100'
    }`;

  const panel = (
    <div className="w-64">
      <div className="flex items-center gap-1 pb-2">
        <span className="mr-auto text-xs text-gray-400">
          共 {options.length} 个厂商
        </span>
        <button
          type="button"
          className={sortBtnCls(sort === 'count')}
          onClick={() => setSort('count')}
        >
          词条数
        </button>
        <button
          type="button"
          className={sortBtnCls(sort === 'name')}
          onClick={() => setSort('name')}
        >
          名称
        </button>
      </div>
      <Input
        size="small"
        allowClear
        prefix={<SearchOutlined className="text-gray-300" />}
        value={kw}
        onChange={(e) => setKw(e.target.value)}
        placeholder="搜索厂商"
      />
      <div className="-mx-1 mt-2 max-h-72 overflow-y-auto">
        <button
          type="button"
          onClick={() => pick(null)}
          className={rowCls(!value)}
        >
          <span className="flex-1 truncate text-left">全部厂商</span>
        </button>
        {list.map((o) => (
          <button
            key={o.id}
            type="button"
            title={o.name}
            onClick={() => pick(o.id)}
            className={rowCls(o.id === value)}
          >
            <MakerLogo name={o.name} size={20} />
            <span className="min-w-0 flex-1 truncate text-left">{o.name}</span>
            <span className="text-xs text-gray-400">{o.count}</span>
          </button>
        ))}
        {list.length === 0 && (
          <div className="px-2 py-6 text-center text-xs text-gray-400">
            无匹配厂商
          </div>
        )}
      </div>
    </div>
  );

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setKw('');
      }}
      placement="bottomLeft"
      content={panel}
    >
      <button
        type="button"
        className="flex h-8 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm hover:border-gray-300"
      >
        {current ? <MakerLogo name={current.name} size={18} /> : null}
        <span className="max-w-[8rem] truncate">
          {current ? current.name : '厂商：全部'}
        </span>
        <DownOutlined className="text-[10px] text-gray-400" />
      </button>
    </Popover>
  );
};

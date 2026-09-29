import { PropsWithChildren, ReactNode, createContext, useContext } from 'react';
import { SettingFilled } from '@ant-design/icons';

export interface SectionProps extends PropsWithChildren {
  title: string;
  name: string;
  titleIcon?: ReactNode;
  /** 新手引导锚点（渲染为 data-tour 属性） */
  dataTour?: string;
}

const context = createContext<Pick<SectionProps, 'name'>>({
  name: '',
});

/** 设置页分组上下文：当前激活分组 + 区块名→分组映射（用于左栏二级导航筛选区块） */
export interface SettingsTabCtx {
  active: string;
  groupOf: (sectionName: string) => string;
}
export const SettingsTabContext = createContext<SettingsTabCtx | null>(null);

export const Section: React.FC<SectionProps> = ({
  name,
  title,
  children,
  titleIcon = <SettingFilled />,
  dataTour,
}) => {
  // 有分组上下文时，只显示当前分组下的区块
  const tab = useContext(SettingsTabContext);
  if (tab && tab.groupOf(name) !== tab.active) {
    return null;
  }
  return (
    <context.Provider value={{ name }}>
      <section
        className="mb-4 bg-white p-4 border-[1px] rounded-md"
        aria-label={title}
        data-tour={dataTour}
      >
        <h2 className="font-bold text-xl mb-4 flex items-center">
          <span
            className="text-ant-color-primary transform translate-y-[1px]"
            aria-hidden
          >
            {titleIcon}
          </span>
          <span className="ml-2">{title}</span>
        </h2>
        {children}
      </section>
    </context.Provider>
  );
};

export function useSectionContext() {
  return useContext(context);
}

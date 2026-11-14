import { getErrorMessage } from '../utils/error';
import {
  AppstoreAddOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  LeftOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { App, Button, Dropdown, Empty, Input, MenuProps, Modal } from 'antd';
import { dialog, fs, invoke } from '@tauri-apps/api';
import { getCurrent } from '@tauri-apps/api/window';
import clsx from 'clsx';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PageHeader } from '../components/PageHeader';
import { EntryEditModal } from '../components/launcher/EntryEditModal';
import { LauncherEntryIcon } from '../components/launcher/LauncherEntryIcon';
import {
  LAUNCHER_ALL_ID,
  LAUNCHER_UNCLASSIFIED_ID,
  LauncherTagSidebar,
} from '../components/launcher/LauncherTagSidebar';
import {
  LauncherEntry,
  LauncherEntryKind,
  LauncherTag,
  collectTagSubtree,
  useLauncherStore,
} from '../stores/launcher';
import { DropTarget, hitTestTarget, isTauri } from '../utils/drop-target';
import { cacheImageFile } from '../utils/image-cache';
import { showInFolder } from '../utils/shell';

type TagEditState =
  | { mode: 'create'; parentId: string | null }
  | { mode: 'rename'; tag: LauncherTag };

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|ico)$/i;

function isImagePath(filePath: string): boolean {
  return IMAGE_EXT.test(filePath);
}

/** 按扩展名判断文件类启动项（exe / 快捷方式） */
function classifyFile(
  path: string,
): { kind: 'exe' | 'shortcut'; name: string } | null {
  const base = path.split(/[\\/]/).filter(Boolean).pop() || path;
  if (/\.exe$/i.test(base)) {
    return { kind: 'exe', name: base.replace(/\.exe$/i, '') };
  }
  if (/\.(lnk|url)$/i.test(base)) {
    return { kind: 'shortcut', name: base.replace(/\.(lnk|url)$/i, '') };
  }
  return null;
}

/** 落点标签：命中优先，否则回退当前选中的自定义标签 */
function resolveTagId(
  hitTagId?: string,
  fallbackTagId?: string,
): string | undefined {
  if (hitTagId) return hitTagId;
  const custom = fallbackTagId
    ? useLauncherStore.getState().tags.some((t) => t.id === fallbackTagId)
    : false;
  if (!custom) {
    log.info('launcher drop 未命中标签，按未分类添加', { fallbackTagId });
  }
  return custom ? fallbackTagId : undefined;
}

/** 启动器：exe / 文件夹快捷启动，多标签树分类 */
export const LauncherPage: React.FC = () => {
  const { message, modal } = App.useApp();
  const entries = useLauncherStore((s) => s.entries);
  const tags = useLauncherStore((s) => s.tags);
  const addEntry = useLauncherStore((s) => s.addEntry);
  const updateEntry = useLauncherStore((s) => s.updateEntry);
  const setEntryTags = useLauncherStore((s) => s.setEntryTags);
  const removeEntry = useLauncherStore((s) => s.removeEntry);
  const moveEntry = useLauncherStore((s) => s.moveEntry);
  const addTag = useLauncherStore((s) => s.addTag);
  const renameTag = useLauncherStore((s) => s.renameTag);
  const removeTag = useLauncherStore((s) => s.removeTag);

  const [selectedTagId, setSelectedTagId] = useState(LAUNCHER_ALL_ID);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editEntry, setEditEntry] = useState<LauncherEntry | null>(null);
  const [tagEdit, setTagEdit] = useState<TagEditState | null>(null);
  const [tagName, setTagName] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const selectedTagRef = useRef(selectedTagId);
  selectedTagRef.current = selectedTagId;
  const hoverTagRef = useRef<string | null>(null);
  const hoverDropTargetRef = useRef<DropTarget | null>(null);
  const [iconHoverEntryId, setIconHoverEntryId] = useState<string | null>(null);

  // 外部文件拖拽时 DOM dragover 不一定触发，这里能记到就记；最终还有光标命中兜底
  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      const el = (event.target as Element | null)?.closest?.(
        '[data-launcher-tag-id]',
      );
      hoverTagRef.current = el?.getAttribute('data-launcher-tag-id') ?? null;
    };
    const clear = () => {
      hoverTagRef.current = null;
    };
    document.addEventListener('dragover', onDragOver, true);
    window.addEventListener('dragend', clear, true);
    return () => {
      document.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('dragend', clear, true);
    };
  }, []);

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const subtreeMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const tag of tags) {
      map.set(tag.id, collectTagSubtree(tags, tag.id));
    }
    return map;
  }, [tags]);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => a.order - b.order),
    [entries],
  );

  const counts = useMemo(() => {
    const byId: Record<string, number> = {};
    for (const tag of tags) {
      const subtree = subtreeMap.get(tag.id) || new Set([tag.id]);
      byId[tag.id] = entries.filter((e) =>
        e.tagIds.some((id) => subtree.has(id)),
      ).length;
    }
    return {
      all: entries.length,
      unclassified: entries.filter((e) => e.tagIds.length === 0).length,
      byId,
    };
  }, [entries, tags, subtreeMap]);

  const filtered = useMemo(() => {
    let list = sortedEntries;
    if (selectedTagId === LAUNCHER_UNCLASSIFIED_ID) {
      list = list.filter((e) => e.tagIds.length === 0);
    } else if (selectedTagId !== LAUNCHER_ALL_ID) {
      const subtree = subtreeMap.get(selectedTagId);
      list = subtree
        ? list.filter((e) => e.tagIds.some((id) => subtree.has(id)))
        : [];
    }
    const kw = keyword.trim().toLowerCase();
    if (kw) {
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(kw) ||
          e.tagIds.some((id) =>
            (tagById.get(id)?.name || '').toLowerCase().includes(kw),
          ),
      );
    }
    return list;
  }, [sortedEntries, selectedTagId, subtreeMap, keyword, tagById]);

  const launch = async (entry: LauncherEntry) => {
    if (!isTauri()) {
      message.info('启动功能仅在桌面版可用');
      return;
    }
    try {
      await invoke('launcher_open', { path: entry.path });
    } catch (err: unknown) {
      message.error(getErrorMessage(err) || '启动失败');
    }
  };

  const reveal = async (entry: LauncherEntry) => {
    try {
      await showInFolder(entry.path, entry.kind !== 'folder');
    } catch (err: unknown) {
      message.error(getErrorMessage(err) || '打开资源管理器失败');
    }
  };

  const addPrograms = async () => {
    try {
      const picked = await dialog.open({
        multiple: true,
        title: '选择程序或快捷方式',
        filters: [
          {
            name: '程序 / 快捷方式',
            extensions: ['exe', 'lnk', 'url'],
          },
        ],
      });
      const files = Array.isArray(picked) ? picked : picked ? [picked] : [];
      files.forEach((path) => {
        const info = classifyFile(path);
        if (!info) return;
        addEntry({ path, name: info.name, kind: info.kind });
      });
      if (files.length > 0) {
        message.success(`已添加 ${files.length} 个启动项`);
      }
    } catch (err: unknown) {
      message.error(getErrorMessage(err) || '选择程序失败');
    }
  };

  const addFolder = async () => {
    try {
      const dir = await dialog.open({
        directory: true,
        title: '选择文件夹',
      });
      if (typeof dir !== 'string') return;
      const name = dir.split(/[\\/]/).filter(Boolean).pop() || dir;
      addEntry({ path: dir, name, kind: 'folder' });
      message.success('已添加文件夹');
    } catch (err: unknown) {
      message.error(getErrorMessage(err) || '选择文件夹失败');
    }
  };

  /** 拖入窗口的路径：exe/快捷方式直接收，文件夹用 readDir 探测；tagId 来自落点命中的标签行 */
  const addDroppedPaths = useCallback(
    async (paths: string[], tagId?: string) => {
      const targetTag = tagId
        ? useLauncherStore.getState().tags.find((t) => t.id === tagId)
        : undefined;
      const existing = new Set(
        useLauncherStore.getState().entries.map((e) => e.path.toLowerCase()),
      );
      let added = 0;
      let skipped = 0;
      for (const path of paths) {
        const file = classifyFile(path);
        let kind: LauncherEntryKind | null = file?.kind ?? null;
        if (!kind) {
          try {
            await fs.readDir(path);
            kind = 'folder';
          } catch {
            kind = null;
          }
        }
        if (!kind || existing.has(path.toLowerCase())) {
          skipped += 1;
          continue;
        }
        existing.add(path.toLowerCase());
        const base = path.split(/[\\/]/).filter(Boolean).pop() || path;
        const id = addEntry({
          path,
          name: file?.name || base,
          kind,
        });
        if (targetTag) setEntryTags(id, [targetTag.id]);
        added += 1;
      }
      if (added > 0) {
        message.success(
          `已添加 ${added} 项${targetTag ? `到「${targetTag.name}」` : ''}`,
        );
      }
      if (skipped > 0) {
        message.info(`跳过 ${skipped} 项（重复或不是 exe/快捷方式/文件夹）`);
      }
    },
    [addEntry, setEntryTags, message],
  );

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    let lastHoverAt = 0;
    getCurrent()
      .onFileDropEvent((event) => {
        if (event.payload.type === 'hover') {
          // 拖动中持续记录落点（节流）；图片悬停卡片时高亮提示
          const now = Date.now();
          if (now - lastHoverAt < 120) return;
          lastHoverAt = now;
          const hasImage = event.payload.paths.some(isImagePath);
          void hitTestTarget().then((target) => {
            hoverDropTargetRef.current = target;
            setIconHoverEntryId(
              hasImage && target.entryId ? target.entryId : null,
            );
          });
          return;
        }
        if (event.payload.type === 'cancel') {
          hoverTagRef.current = null;
          hoverDropTargetRef.current = null;
          setIconHoverEntryId(null);
          return;
        }
        if (event.payload.type !== 'drop') return;
        const { paths } = event.payload;
        void (async () => {
          const domTag = hoverTagRef.current;
          const tauriHover = hoverDropTargetRef.current;
          hoverTagRef.current = null;
          hoverDropTargetRef.current = null;
          setIconHoverEntryId(null);

          const fresh = await hitTestTarget();
          const entryId = fresh.entryId || tauriHover?.entryId;
          const image = paths.find(isImagePath);
          if (entryId && image) {
            const entry = useLauncherStore
              .getState()
              .entries.find((e) => e.id === entryId);
            if (entry) {
              try {
                const cached = await cacheImageFile(
                  image,
                  'launcher-icons',
                  'custom',
                );
                updateEntry(entry.id, {
                  iconMode: 'custom',
                  customIcon: cached,
                });
                message.success(`已设为「${entry.name}」的图标`);
              } catch (err: unknown) {
                message.error(getErrorMessage(err) || '设置图标失败');
              }
              return;
            }
          }

          const tagId = resolveTagId(
            fresh.tagId || domTag || tauriHover?.tagId || undefined,
            selectedTagRef.current,
          );
          await addDroppedPaths(paths, tagId);
        })();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [addDroppedPaths, updateEntry, message]);

  const openCreateTag = (parentId: string | null) => {
    setTagName('');
    setTagEdit({ mode: 'create', parentId });
  };

  const openRenameTag = (tag: LauncherTag) => {
    setTagName(tag.name);
    setTagEdit({ mode: 'rename', tag });
  };

  const confirmTagEdit = () => {
    if (!tagEdit) return;
    const name = tagName.trim();
    if (!name) {
      message.error('标签名不能为空');
      return;
    }
    try {
      if (tagEdit.mode === 'create') {
        addTag(name, tagEdit.parentId);
      } else {
        renameTag(tagEdit.tag.id, name);
      }
      setTagEdit(null);
    } catch (err: unknown) {
      message.error(getErrorMessage(err) || '操作失败');
    }
  };

  const confirmRemoveTag = (tag: LauncherTag) => {
    const subtree = collectTagSubtree(tags, tag.id);
    modal.confirm({
      title: `删除标签「${tag.name}」？`,
      content:
        subtree.size > 1
          ? '其所有子标签也会被删除；启动项只会解除关联，不会被删除。'
          : '启动项只会解除关联，不会被删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        removeTag(tag.id);
        if (subtree.has(selectedTagId)) setSelectedTagId(LAUNCHER_ALL_ID);
      },
    });
  };

  const confirmRemoveEntry = (entry: LauncherEntry) => {
    modal.confirm({
      title: `删除启动项「${entry.name}」？`,
      content: '只删除配置，不会删除磁盘上的程序或文件夹。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        removeEntry(entry.id);
        if (selectedEntryId === entry.id) setSelectedEntryId(null);
      },
    });
  };

  return (
    <div className="flex flex-col h-screen">
      <PageHeader />
      <div className="flex-1 min-h-0 flex gap-2 pb-4">
        {!sidebarCollapsed && (
          <LauncherTagSidebar
            tags={tags}
            selectedId={selectedTagId}
            onSelect={(id) => setSelectedTagId(id)}
            counts={counts}
            onAddRoot={() => openCreateTag(null)}
            onAddChild={(tag) => openCreateTag(tag.id)}
            onRename={openRenameTag}
            onRemove={confirmRemoveTag}
            onDropEntry={(tagId) => {
              if (!dragId) return;
              const entry = entries.find((e) => e.id === dragId);
              if (entry && !entry.tagIds.includes(tagId)) {
                setEntryTags(entry.id, [...entry.tagIds, tagId]);
              }
              setDragId(null);
            }}
          />
        )}
        <button
          type="button"
          aria-label={sidebarCollapsed ? '展开标签树' : '折叠标签树'}
          title={sidebarCollapsed ? '展开标签树' : '折叠标签树'}
          onClick={() => setSidebarCollapsed((v) => !v)}
          className="flex w-7 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400 transition-colors hover:text-gray-800"
        >
          {sidebarCollapsed ? <RightOutlined /> : <LeftOutlined />}
        </button>
        <section
          className="flex-1 min-w-0 flex flex-col"
          aria-label="启动器内容"
        >
          <div className="flex flex-wrap items-center gap-2 pb-2">
            <Input
              allowClear
              prefix={<SearchOutlined className="text-gray-300" />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索名称或标签"
              className="w-56"
            />
            <span className="text-sm text-gray-400">
              共 {entries.length} 个
              {filtered.length !== entries.length
                ? ` · 当前 ${filtered.length} 个`
                : ''}
            </span>
            <span className="text-xs text-gray-300">
              支持把 exe / 快捷方式 / 文件夹拖进页面；图片拖到卡片上可设为图标
            </span>
            <span className="ml-auto" />
            <Button icon={<AppstoreAddOutlined />} onClick={addPrograms}>
              添加应用
            </Button>
            <Button icon={<FolderAddOutlined />} onClick={addFolder}>
              添加文件夹
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto pb-6">
            {filtered.length === 0 ? (
              <Empty
                className="mt-16"
                description={
                  entries.length === 0
                    ? '还没有启动项，点右上角「添加应用 / 添加文件夹」，或直接拖入 exe / .lnk / .url'
                    : '没有匹配的启动项'
                }
              />
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,10rem))] gap-3">
                {filtered.map((entry) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    tags={tags}
                    selected={selectedEntryId === entry.id}
                    dragging={dragId === entry.id}
                    iconHover={iconHoverEntryId === entry.id}
                    onClick={() => setSelectedEntryId(entry.id)}
                    onLaunch={() => launch(entry)}
                    onReveal={() => reveal(entry)}
                    onEdit={() => setEditEntry(entry)}
                    onRemove={() => confirmRemoveEntry(entry)}
                    onDragStart={(e) => {
                      setDragId(entry.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => {
                      if (dragId && dragId !== entry.id) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragId && dragId !== entry.id) {
                        moveEntry(dragId, entry.id);
                      }
                      setDragId(null);
                    }}
                    onDragEnd={() => setDragId(null)}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <EntryEditModal
        open={!!editEntry}
        entry={editEntry}
        tags={tags}
        onClose={() => setEditEntry(null)}
      />

      <Modal
        open={!!tagEdit}
        title={tagEdit?.mode === 'rename' ? '重命名标签' : '新建标签'}
        okText={tagEdit?.mode === 'rename' ? '保存' : '创建'}
        cancelText="取消"
        onOk={confirmTagEdit}
        onCancel={() => setTagEdit(null)}
        destroyOnClose
      >
        <Input
          autoFocus
          value={tagName}
          placeholder="标签名，如 游戏 / 工具"
          onChange={(e) => setTagName(e.target.value)}
          onPressEnter={confirmTagEdit}
        />
        {tagEdit?.mode === 'create' && tagEdit.parentId && (
          <p className="mt-2 text-xs text-gray-400">
            将创建为「{tagById.get(tagEdit.parentId)?.name || '父标签'}
            」的子标签
          </p>
        )}
      </Modal>
    </div>
  );
};

interface EntryCardProps {
  entry: LauncherEntry;
  tags: LauncherTag[];
  selected: boolean;
  dragging: boolean;
  /** 图片拖到卡片上：高亮提示可设为图标 */
  iconHover: boolean;
  onClick: () => void;
  onLaunch: () => void;
  onReveal: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onDragStart: React.DragEventHandler<HTMLLIElement>;
  onDragOver: React.DragEventHandler<HTMLLIElement>;
  onDrop: React.DragEventHandler<HTMLLIElement>;
  onDragEnd: React.DragEventHandler<HTMLLIElement>;
}

const EntryCard: React.FC<EntryCardProps> = ({
  entry,
  tags,
  selected,
  dragging,
  iconHover,
  onClick,
  onLaunch,
  onReveal,
  onEdit,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) => {
  const tagNames = entry.tagIds
    .map((id) => tags.find((t) => t.id === id)?.name)
    .filter((name): name is string => !!name);

  const menu: MenuProps = {
    items: [
      { key: 'launch', label: '启动', icon: <FolderOpenOutlined /> },
      { key: 'reveal', label: '在资源管理器中显示' },
      { type: 'divider' },
      { key: 'edit', label: '编辑', icon: <EditOutlined /> },
      {
        key: 'remove',
        label: '删除',
        icon: <DeleteOutlined />,
        danger: true,
      },
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === 'launch') onLaunch();
      if (key === 'reveal') onReveal();
      if (key === 'edit') onEdit();
      if (key === 'remove') onRemove();
    },
  };

  return (
    <Dropdown trigger={['contextMenu']} menu={menu}>
      <li
        draggable
        data-launcher-entry-id={entry.id}
        onClick={onClick}
        onDoubleClick={onLaunch}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        className={clsx(
          'relative cursor-pointer overflow-hidden rounded-md border-[1px] bg-white transition-shadow hover:shadow-sm',
          selected
            ? 'border-ant-color-primary ring-1 ring-ant-color-primary'
            : 'border-gray-100',
          iconHover && 'ring-2 ring-ant-color-primary',
          dragging && 'opacity-40',
        )}
        title={`${entry.name}\n${entry.path}`}
      >
        <div className="h-[6.5rem] w-full overflow-hidden">
          <LauncherEntryIcon entry={entry} size={40} fill />
        </div>
        {iconHover && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[rgba(0,0,0,0.45)] px-2 text-center text-xs text-white">
            松手设为图标
          </div>
        )}
        <div className="px-2 pb-2">
          <p className="truncate text-center text-sm" title={entry.name}>
            {entry.name}
          </p>
          <div className="mt-1 flex h-4 flex-wrap justify-center gap-1 overflow-hidden">
            {tagNames.slice(0, 3).map((name) => (
              <span
                key={name}
                className="max-w-full truncate rounded bg-gray-100 px-1 text-[10px] leading-4 text-gray-500"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </li>
    </Dropdown>
  );
};

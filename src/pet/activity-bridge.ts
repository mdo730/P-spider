/**
 * 副作用桥接：把业务事件翻译成宠物活动。
 *
 * 这是 pet 模块**唯一**与业务代码耦合的地方（在 main.tsx 里副作用 import）。
 * 想整体抽出宠物功能时，删掉本文件与本 import 即可，pet 本体照常独立运行。
 */

import { useAppStateStore } from '../stores/app-state';
import { onTaskCompleted } from '../stores/download';
import { useRouteStore } from '../stores/route';
import { emitPetActivity } from './activity';

// 下载完成 → 产金
onTaskCompleted.listen(() => {
  emitPetActivity('download');
});

// 搜索 → 监听搜索历史栈顶变化
let lastSearch: string | null =
  useAppStateStore.getState().searchHistory[0] ?? null;
useAppStateStore.subscribe((s) => {
  const top = s.searchHistory[0] ?? null;
  if (top && top !== lastSearch) {
    lastSearch = top;
    emitPetActivity('search');
  }
});

// 浏览 → 打开文章详情（pendingArticle 变化，按 page:postId 去重）
let lastArticle: string | null = null;
useRouteStore.subscribe((s) => {
  const p = s.pendingArticle;
  if (!p) return;
  const key = `${p.page}:${p.postId}`;
  if (key !== lastArticle) {
    lastArticle = key;
    emitPetActivity('browse');
  }
});

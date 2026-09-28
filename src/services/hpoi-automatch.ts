import { FigmemoListItem, setHpoiMatch } from './figmemo';
import {
  HPOI_MATCH_CATEGORY_IDS,
  HpoiMatch,
  candidateToMatch,
  findHpoiCandidates,
  parseFigmemoFields,
} from './hpoi';

/** 本会话已尝试过的文章（失败不重复试） */
const attempted = new Set<string>();

/**
 * 新文章加载后，后台自动匹配 Hpoi（仅命中 HPOI 白名单分类、且尚未关联的文章）。
 * 串行 + 间隔，取第一个候选；不阻塞界面。
 */
export async function autoMatchHpoi(
  items: FigmemoListItem[],
  onMatched: (postId: string, hpoi: HpoiMatch) => void,
  limit = 40,
): Promise<number> {
  const pending = items
    .filter(
      (it) =>
        !it.hpoi &&
        !it.hpoiRemoved &&
        !attempted.has(String(it.postId)) &&
        (it.categories || []).some((c) =>
          HPOI_MATCH_CATEGORY_IDS.includes(c.id),
        ),
    )
    .slice(0, limit);
  if (pending.length === 0) return 0;
  let n = 0;
  for (const it of pending) {
    attempted.add(String(it.postId));
    try {
      const info = parseFigmemoFields(it.title);
      const cands = await findHpoiCandidates(info, 2, 1);
      const first = cands[0];
      if (first) {
        const hpoi = candidateToMatch(first);
        onMatched(String(it.postId), hpoi);
        await setHpoiMatch(it, hpoi);
        n += 1;
      }
    } catch {
      // 忽略单个失败
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return n;
}

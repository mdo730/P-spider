/**
 * 桌面宠物窗根组件（label === 'pet' 时渲染）。
 *
 * 唯一宿主：持有 pet store、监听活跃度事件、驱动托盘 tooltip。
 * 布局：宠物锚定**右上角**，面板出现在宠物**左侧**（窗口向左扩展，宠物屏幕位置不变）。
 * 交互：拖拽 / 点击展开圆按钮 / 点按钮开面板（点空白关闭）/ 首次领养命名。
 */

import { invoke } from '@tauri-apps/api';
import { listen } from '@tauri-apps/api/event';
import { getCurrent } from '@tauri-apps/api/window';
import { Button, Input, Progress, Switch } from 'antd';
import React, { useEffect, useReducer, useRef, useState } from 'react';
import { PET_ACTIVITY_EVENT } from '../activity';
import {
  jobById,
  JOBS,
  SKILL_MAX,
  skillTuition,
  SUBJECT_MAP,
  SUBJECTS,
  WORK_SHIFTS,
} from '../career';
import {
  DEFAULT_PET_NAME,
  LOW_THRESHOLD,
  MOOD_SAD,
  STUDY,
  WORK,
} from '../constants';
import {
  assets,
  computeLevel,
  eduName,
  getHealth,
  getMood,
  getStage,
  industryIncomePerHour,
  industryLevel,
  isIndustryUnlocked,
  isJobQualified,
  isSick,
  isSkinUnlocked,
  jobPay,
  levelProgress,
  skillLevel,
  taskRemaining,
  totalSkill,
  type PetResult,
} from '../engine';
import {
  INDUSTRIES,
  INDUSTRY_IMAGES,
  industryIncome,
  industryPrice,
} from '../industry';
import {
  CATEGORY_LABEL,
  ITEMS,
  itemCount,
  type ItemCategory,
  type PetItem,
} from '../items';
import { resizePetWindow } from '../open-window';
import { usePetStore } from '../pet-store';
import { pickPhrase } from '../phrases';
import { SKINS, skinById, skinImage } from '../skins';
import { playCoinSound, playUnlockSound } from '../sound';
import { updateTrayTooltip } from '../tray';
import type { PetAction, PetActivityType, PetState } from '../types';
import { BananaSprite } from '../ui/BananaSprite';

type TopicKey =
  | 'care'
  | 'shop'
  | 'work'
  | 'study'
  | 'dex'
  | 'attr'
  | 'industry';

const TOPICS: { key: TopicKey; emoji: string; label: string }[] = [
  { key: 'care', emoji: '🍚', label: '照顾' },
  { key: 'shop', emoji: '🛒', label: '商店' },
  { key: 'work', emoji: '💼', label: '打工' },
  { key: 'study', emoji: '📚', label: '学习' },
  { key: 'dex', emoji: '📖', label: '图鉴' },
  { key: 'attr', emoji: '📊', label: '属性' },
  { key: 'industry', emoji: '🏭', label: '产业' },
];

const CATEGORY_ORDER: ItemCategory[] = ['food', 'clean', 'toy', 'medicine'];

const STAGE_LABEL: Record<string, string> = {
  child: '幼年',
  adult: '成年',
  elder: '长者',
};

const BUBBLE_CN: Record<string, string> = {
  sick: '咳咳…不太舒服…',
  hungry: '咕…肚子饿了…',
  dirty: '身上脏脏的…',
  mood: '心情有点低落…',
  work: '打工中！',
  study: '学习中～',
  happy: '今天也要开心哦～',
  idle: '……（叉腰看着你）',
};
const BUBBLE_SH: Record<string, string> = {
  sick: '咳咳…我勿适意…',
  hungry: '咕…肚皮饿煞了…',
  dirty: '身浪向龌龊来…',
  mood: '心情有点点低落…',
  work: '打工当中！',
  study: '读书当中～',
  happy: '今朝也要开心哦～',
  idle: '……（叉腰看牢侬）',
};

function bubbleText(s: PetState, shanghai = false): string {
  let key = 'idle';
  if (isSick(s)) key = 'sick';
  else if (s.satiety < LOW_THRESHOLD) key = 'hungry';
  else if (s.cleanliness < LOW_THRESHOLD) key = 'dirty';
  else if (s.mood < MOOD_SAD) key = 'mood';
  else if (s.task) key = s.task.type === 'work' ? 'work' : 'study';
  else if (s.mood >= 70) key = 'happy';
  return (shanghai ? BUBBLE_SH : BUBBLE_CN)[key];
}

function BarRow({
  label,
  value,
  max = 100,
  text,
  color,
}: {
  label: string;
  value: number;
  max?: number;
  text?: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-10 shrink-0 text-gray-500">{label}</span>
      <Progress
        percent={Math.round((value / max) * 100)}
        showInfo={false}
        strokeColor={color}
        size="small"
        className="!m-0 flex-1"
      />
      <span className="w-12 shrink-0 text-right tabular-nums text-gray-600">
        {text ?? Math.round(value)}
      </span>
    </div>
  );
}

export const PetDesktop: React.FC = () => {
  const pet = usePetStore();
  const [, force] = useReducer((x) => x + 1, 0);
  const [hydrated, setHydrated] = useState(() =>
    usePetStore.persist.hasHydrated(),
  );
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<TopicKey | null>(null);
  const [hover, setHover] = useState(false);
  const [action, setAction] = useState<PetAction>('idle');
  const [toast, setToast] = useState<string | null>(null);
  const [speech, setSpeech] = useState<string | null>(null);
  const [floats, setFloats] = useState<{ id: number; text: string }[]>([]);
  const [celeb, setCeleb] = useState<{
    key: number;
    name: string;
    emoji: string;
    skinId: string;
  } | null>(null);
  const [nameInput, setNameInput] = useState(DEFAULT_PET_NAME);
  const [effect, setEffect] = useState<{
    id: number;
    kind: 'feed' | 'clean' | 'play' | 'heal';
    emoji: string;
  } | null>(null);
  const actionTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const effectTimer = useRef<number | undefined>(undefined);
  const speechTimer = useRef<number | undefined>(undefined);
  const lastCoin = useRef<number | null>(null);
  const lastSkills = useRef<Record<string, number> | null>(null);
  const lastLevel = useRef<number | null>(null);
  const lastTask = useRef<boolean | null>(null);
  const unlockedSkins = useRef<Set<string> | null>(null);
  const celebQueue = useRef<{ name: string; emoji: string; skinId: string }[]>(
    [],
  );
  const celebActive = useRef(false);
  // 可交互命中区（点击穿透用）
  const spriteRef = useRef<HTMLDivElement | null>(null);
  const buttonsRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const badgeRef = useRef<HTMLDivElement | null>(null);
  const adoptRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const tapTimer = useRef<number | undefined>(undefined);
  const tapCount = useRef(0);
  const huaTimer = useRef<number | undefined>(undefined);
  const [huaFx, setHuaFx] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // 等持久化水合完成（避免默认存档覆盖真实存档）
  useEffect(() => {
    if (hydrated) return;
    const un = usePetStore.persist.onFinishHydration(() => setHydrated(true));
    if (usePetStore.persist.hasHydrated()) setHydrated(true);
    return un;
  }, [hydrated]);

  const flash = (a: PetAction) => {
    setAction(a);
    window.clearTimeout(actionTimer.current);
    actionTimer.current = window.setTimeout(() => setAction('idle'), 900);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  };

  const run = (r: PetResult, a: PetAction) => {
    if (r.ok) {
      flash(a);
      if (r.message) showToast(r.message);
    } else {
      showToast(r.message ?? '现在做不了');
    }
    return r.ok;
  };

  const triggerEffect = (
    kind: 'feed' | 'clean' | 'play' | 'heal',
    emoji: string,
  ) => {
    setEffect({ id: Date.now(), kind, emoji });
    window.clearTimeout(effectTimer.current);
    effectTimer.current = window.setTimeout(
      () => setEffect(null),
      kind === 'play' ? 1800 : kind === 'clean' ? 1600 : 1300,
    );
  };

  const pushFloat = (text: string) => {
    const id = Date.now() + Math.random();
    setFloats((f) => [...f, { id, text }]);
    window.setTimeout(
      () => setFloats((f) => f.filter((x) => x.id !== id)),
      1200,
    );
  };

  // 皮肤解锁庆祝（队列逐个播放）
  const startCeleb = () => {
    const next = celebQueue.current.shift();
    if (!next) {
      celebActive.current = false;
      setCeleb(null);
      return;
    }
    celebActive.current = true;
    setCeleb({ key: Date.now(), ...next });
    if (usePetStore.getState().soundOn) playUnlockSound();
    window.setTimeout(() => startCeleb(), 2600);
  };

  // 三连击：揍滑彩蛋（每小时一次）
  const triggerHua = () => {
    const r = usePetStore.getState().rewardHua();
    if (!r.ok) {
      showToast(r.message ?? '现在不行');
      return;
    }
    setHuaFx(Date.now());
    window.clearTimeout(huaTimer.current);
    huaTimer.current = window.setTimeout(() => setHuaFx(null), 2400);
    showToast(r.message ?? '');
  };

  useEffect(() => {
    document.documentElement.classList.add('pet-window');
    return () => document.documentElement.classList.remove('pet-window');
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => force(), 1000);
    return () => window.clearInterval(t);
  }, []);

  const sync = pet.sync;
  useEffect(() => {
    if (!hydrated) return;
    sync();
    const t = window.setInterval(() => sync(), 60000);
    return () => window.clearInterval(t);
  }, [sync, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const p = listen(PET_ACTIVITY_EVENT, (e) => {
      usePetStore.getState().addActivity(e.payload as PetActivityType);
    });
    return () => {
      void p.then((un) => un());
    };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    updateTrayTooltip(pet);
  }, [pet, hydrated]);

  // 变化飘字：金币 / 学科升级 / 等级提升
  useEffect(() => {
    if (!hydrated) return;

    // 金币
    if (lastCoin.current === null) lastCoin.current = pet.coin;
    else {
      const diff = Math.floor(pet.coin - lastCoin.current);
      lastCoin.current = pet.coin;
      if (diff >= 1) {
        pushFloat(`🪙 +${diff}`);
        if (pet.soundOn) playCoinSound();
      }
    }

    // 学科等级（学习完成）
    if (lastSkills.current === null) lastSkills.current = { ...pet.skills };
    else {
      for (const sub of SUBJECTS) {
        const prev = lastSkills.current[sub.id] ?? 0;
        const cur = pet.skills[sub.id] ?? 0;
        if (cur > prev) pushFloat(`${sub.emoji} ${sub.name} Lv+${cur - prev}`);
      }
      lastSkills.current = { ...pet.skills };
    }

    // 等级
    const lvNow = computeLevel(pet.exp);
    if (lastLevel.current === null) lastLevel.current = lvNow;
    else if (lvNow > lastLevel.current) {
      pushFloat(`⭐ 升级 Lv.${lvNow}`);
      lastLevel.current = lvNow;
    }

    // 完成一个内容（打工/学习结束）→ 跳一下
    const hasTask = !!pet.task;
    if (lastTask.current === null) lastTask.current = hasTask;
    else {
      if (lastTask.current && !hasTask) flash('jump');
      lastTask.current = hasTask;
    }
  }, [pet.coin, pet.skills, pet.exp, pet.task, hydrated]);

  // 皮肤解锁检测 → 弹庆祝
  useEffect(() => {
    if (!hydrated) return;
    const nowUnlocked = new Set(
      SKINS.filter((sk) => isSkinUnlocked(pet, sk)).map((sk) => sk.id),
    );
    if (unlockedSkins.current === null) {
      unlockedSkins.current = nowUnlocked;
      return;
    }
    const newly = [...nowUnlocked].filter(
      (id) => !unlockedSkins.current!.has(id),
    );
    unlockedSkins.current = nowUnlocked;
    if (newly.length === 0) return;
    for (const id of newly) {
      const sk = SKINS.find((s) => s.id === id);
      if (sk)
        celebQueue.current.push({
          name: sk.name,
          emoji: sk.emoji,
          skinId: sk.id,
        });
    }
    if (!celebActive.current) startCeleb();
  }, [pet, hydrated]);

  // 上报可交互命中区（Rust 侧据此切换鼠标穿透）
  useEffect(() => {
    if (!('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) return;
    const send = () => {
      const els = [
        spriteRef.current,
        buttonsRef.current,
        panelRef.current,
        badgeRef.current,
        adoptRef.current,
        menuRef.current,
      ].filter((el): el is HTMLDivElement => !!el);
      const rects = els.map((el) => {
        const r = el.getBoundingClientRect();
        return [r.left, r.top, r.width, r.height];
      });
      void invoke('pet_set_hit_rects', { rects }).catch(() => undefined);
    };
    send();
    const t = window.setInterval(send, 500);
    return () => window.clearInterval(t);
  }, []);

  // 随机小短语：开窗 8 秒先来一条（便于确认），之后每 1~5 分钟一条，气泡显示 8 秒
  useEffect(() => {
    if (!hydrated || !pet.phraseOn) return;
    let timeout: number;
    let first = true;
    const schedule = () => {
      const delay = first ? 8000 : (60 + Math.random() * 240) * 1000;
      first = false;
      timeout = window.setTimeout(() => {
        const st = usePetStore.getState();
        setSpeech(pickPhrase(st, st.shanghaiOn));
        flash('jump');
        window.clearTimeout(speechTimer.current);
        speechTimer.current = window.setTimeout(() => setSpeech(null), 8000);
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(timeout);
  }, [hydrated, pet.phraseOn]);

  // 窗口尺寸（属性面板更大）
  useEffect(() => {
    if (!hydrated) return;
    const size = !pet.adopted
      ? 'adopt'
      : view === 'attr'
        ? 'attr'
        : view
          ? 'panel'
          : 'base';
    void resizePetWindow(size);
  }, [hydrated, pet.adopted, view]);

  useEffect(
    () => () => {
      window.clearTimeout(actionTimer.current);
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(effectTimer.current);
      window.clearTimeout(speechTimer.current);
      window.clearTimeout(tapTimer.current);
      window.clearTimeout(huaTimer.current);
    },
    [],
  );

  const onSpritePointerDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // 只处理左键（右键留给设置菜单）
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const move = (ev: MouseEvent) => {
      if (
        !moved &&
        (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4)
      ) {
        moved = true;
        try {
          void getCurrent().startDragging();
        } catch {
          // 非 Tauri 环境忽略
        }
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (moved || view || menuOpen) return;
      tapCount.current += 1;
      window.clearTimeout(tapTimer.current);
      if (tapCount.current >= 3) {
        // 三连击 → 揍滑
        tapCount.current = 0;
        triggerHua();
        return;
      }
      tapTimer.current = window.setTimeout(() => {
        const n = tapCount.current;
        tapCount.current = 0;
        if (n === 1) setExpanded((v) => !v);
        else if (n === 2) run(pet.pat(), 'pat');
      }, 350);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const mood = getMood(pet);
  const health = getHealth(pet);
  const sick = isSick(pet);
  const skin = skinById(pet.skin);
  const skinImg = skinImage(skin.id);
  const busy = !!pet.task;
  const now = Date.now();
  const remainMs = taskRemaining(pet.task, now);
  const totalMs = pet.task
    ? pet.task.type === 'work'
      ? (pet.task.minutes ?? 30) * 60000
      : STUDY.durationMs
    : 1;
  const taskPct = pet.task ? Math.round(100 * (1 - remainMs / totalMs)) : 0;
  const lv = levelProgress(pet.exp);

  // 进行中任务的展示信息（学习某学科 / 打某工种）
  let taskInfo: { emoji: string; name: string; kind: string } | null = null;
  if (pet.task) {
    if (pet.task.type === 'work') {
      const job = jobById(pet.task.jobId);
      if (job) taskInfo = { emoji: job.emoji, name: job.name, kind: '打工' };
    } else {
      const sub = SUBJECT_MAP[pet.task.subject ?? ''];
      if (sub) taskInfo = { emoji: sub.emoji, name: sub.name, kind: '学习' };
    }
  }

  const useItem = (item: PetItem) => {
    let r: PetResult;
    let action: PetAction;
    let fx: 'feed' | 'clean' | 'play' | 'heal';
    if (item.category === 'food') {
      r = pet.feed(item.id);
      action = 'eat';
      fx = 'feed';
    } else if (item.category === 'clean') {
      r = pet.clean(item.id);
      action = 'clean';
      fx = 'clean';
    } else if (item.category === 'toy') {
      r = pet.play(item.id);
      action = 'play';
      fx = 'play';
    } else {
      r = pet.heal(item.id);
      action = 'heal';
      fx = 'heal';
    }
    if (run(r, action)) triggerEffect(fx, item.emoji);
  };

  const hasStock = CATEGORY_ORDER.some((cat) =>
    ITEMS.some((it) => it.category === cat && itemCount(pet, it) > 0),
  );

  const taskProgress = pet.task && (
    <div className="mb-1">
      <div className="mb-0.5 text-[10px] text-gray-500">
        {pet.task.type === 'work' ? '打工中' : '学习中'}…剩{' '}
        {Math.ceil(remainMs / 60000)} 分
      </div>
      <Progress percent={taskPct} strokeColor="#52c41a" size="small" />
    </div>
  );

  const carePanel = (
    <div className="space-y-1.5">
      {CATEGORY_ORDER.map((cat) => {
        const list = ITEMS.filter(
          (it) => it.category === cat && itemCount(pet, it) > 0,
        );
        if (list.length === 0) return null;
        return (
          <div key={cat} className="flex flex-wrap items-center gap-1">
            <span className="w-6 shrink-0 text-[10px] text-gray-400">
              {CATEGORY_LABEL[cat]}
            </span>
            {list.map((it) => (
              <Button key={it.id} size="small" onClick={() => useItem(it)}>
                {it.emoji}×{itemCount(pet, it)}
              </Button>
            ))}
          </div>
        );
      })}
      {!hasStock && (
        <div className="text-[10px] text-gray-400">
          背包空空的，去商店买点吧～
        </div>
      )}
      <Button size="small" block onClick={() => run(pet.pat(), 'pat')}>
        🤏 摸摸头
      </Button>
    </div>
  );

  const shopPanel = (
    <div className="space-y-2">
      {CATEGORY_ORDER.map((cat) => (
        <div key={cat}>
          <div className="mb-1 text-[10px] text-gray-400">
            {CATEGORY_LABEL[cat]}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {ITEMS.filter((it) => it.category === cat).map((it) => (
              <div
                key={it.id}
                className="flex flex-col items-center rounded-lg border border-gray-100 px-1 py-1.5"
              >
                <span className="text-2xl leading-none">{it.emoji}</span>
                <span className="mt-1 text-center text-[11px] leading-tight">
                  {it.name}
                </span>
                <div className="mt-1 flex items-center gap-1">
                  <span className="text-[10px] text-ant-gold-6">
                    🪙{it.price}
                  </span>
                  <Button
                    size="small"
                    type="primary"
                    disabled={pet.coin < it.price}
                    onClick={() => {
                      const r = pet.buy(it.id, 1);
                      showToast(r.message ?? (r.ok ? '购买成功' : '买不起'));
                    }}
                  >
                    🛒
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const workPanel = (
    <div className="space-y-1.5">
      {taskProgress}
      {JOBS.map((job) => {
        const qualified = isJobQualified(pet, job);
        return (
          <div key={job.id} className="rounded-lg border border-gray-100 p-1.5">
            <div className="flex items-center gap-1 text-[11px]">
              <span>{job.emoji}</span>
              <span className="min-w-0 flex-1 truncate">{job.name}</span>
              {!qualified && (
                <span className="shrink-0 text-[10px] text-red-400">
                  需 {SUBJECT_MAP[job.subject]?.name ?? ''} Lv{job.minSkill}
                </span>
              )}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {WORK_SHIFTS.map((sh) => {
                const eCost = Math.round(WORK.energyCost * (sh.minutes / 30));
                return (
                  <Button
                    key={sh.minutes}
                    size="small"
                    type={qualified ? 'primary' : 'default'}
                    ghost={qualified}
                    disabled={!qualified || busy || sick || pet.energy < eCost}
                    onClick={() =>
                      run(pet.startWork(job.id, sh.minutes), 'work')
                    }
                  >
                    {sh.label} · 🪙{jobPay(pet, job, sh.minutes)}
                  </Button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );

  const studyPanel = (
    <div className="space-y-1.5">
      {taskProgress}
      {SUBJECTS.map((sub) => {
        const sLv = skillLevel(pet, sub.id);
        const maxed = sLv >= SKILL_MAX;
        const cost = skillTuition(sLv);
        return (
          <div key={sub.id} className="rounded-lg border border-gray-100 p-1.5">
            <div className="flex items-center gap-1 text-[11px]">
              <span>{sub.emoji}</span>
              <span className="min-w-0 flex-1 truncate">{sub.name}</span>
              <span className="text-[10px] text-gray-400">
                Lv{sLv}/{SKILL_MAX}
              </span>
            </div>
            <Progress
              className="!my-1"
              percent={Math.round((sLv / SKILL_MAX) * 100)}
              showInfo={false}
              strokeColor="#722ed1"
              size="small"
            />
            <Button
              size="small"
              block
              disabled={maxed || busy || sick || pet.coin < cost}
              onClick={() => run(pet.startStudy(sub.id), 'study')}
            >
              {maxed ? '已满级' : `📚 学习 · 🪙${cost}`}
            </Button>
          </div>
        );
      })}
    </div>
  );

  const dexPanel = (
    <div className="grid grid-cols-3 gap-1.5">
      {SKINS.map((sk) => {
        const unlocked = isSkinUnlocked(pet, sk);
        const active = pet.skin === sk.id;
        const img = skinImage(sk.id);
        return (
          <button
            key={sk.id}
            disabled={!unlocked}
            onClick={() => run(pet.setSkin(sk.id), 'pat')}
            className={
              'flex flex-col items-center rounded border px-1 py-1.5 text-center ' +
              (active
                ? 'border-ant-color-primary bg-ant-color-primary-bg'
                : unlocked
                  ? 'border-gray-100 hover:bg-gray-50'
                  : 'border-gray-100 opacity-50')
            }
            title={sk.desc}
          >
            {unlocked && img ? (
              <img
                src={img}
                alt={sk.name}
                draggable={false}
                className="h-8 w-8 object-contain"
              />
            ) : (
              <span
                className="text-xl leading-8"
                style={
                  unlocked ? { filter: sk.filter } : { filter: 'grayscale(1)' }
                }
              >
                {unlocked ? sk.emoji : '🔒'}
              </span>
            )}
            <span className="mt-0.5 text-[10px] leading-tight">{sk.name}</span>
            <span className="text-[9px] leading-tight text-gray-400">
              {active ? '使用中' : unlocked ? sk.desc : ''}
            </span>
          </button>
        );
      })}
    </div>
  );

  const attrPanel = (
    <div className="space-y-2">
      <div className="text-[12px]">
        <span className="font-medium">{pet.name}</span>
        <span className="ml-2 text-gray-500">
          Lv.{lv.level} · {STAGE_LABEL[getStage(pet)]} · {eduName(pet)}
        </span>
        {sick && <span className="ml-2 text-red-500">生病中</span>}
      </div>

      <div className="rounded-lg border border-gray-100 p-2">
        <div className="mb-1 text-[10px] text-gray-400">成长</div>
        <BarRow
          label="经验"
          value={lv.ratio * 100}
          text={`${Math.floor(lv.cur)}/${lv.need}`}
          color="#1677ff"
        />
        <BarRow
          label="好感"
          value={Math.min(100, pet.affinity)}
          color="#eb2f96"
        />
      </div>

      <div className="rounded-lg border border-gray-100 p-2">
        <div className="mb-1 text-[10px] text-gray-400">状态</div>
        <BarRow label="饱腹" value={pet.satiety} color="#faad14" />
        <BarRow label="清洁" value={pet.cleanliness} color="#13c2c2" />
        <BarRow label="心情" value={pet.mood} color="#eb2f96" />
        <BarRow label="健康" value={pet.health} color="#52c41a" />
        <BarRow label="体力" value={pet.energy} color="#1677ff" />
      </div>

      <div className="rounded-lg border border-gray-100 p-2">
        <div className="mb-1 text-[10px] text-gray-400">
          学科能力（总学识 {totalSkill(pet)}）
        </div>
        {SUBJECTS.map((sub) => (
          <BarRow
            key={sub.id}
            label={`${sub.emoji}${sub.name}`}
            value={skillLevel(pet, sub.id)}
            max={SKILL_MAX}
            text={`Lv${skillLevel(pet, sub.id)}/${SKILL_MAX}`}
            color="#722ed1"
          />
        ))}
      </div>

      <div className="rounded-lg border border-gray-100 p-2">
        <div className="mb-1 text-[10px] text-gray-400">
          产业（资产 {assets(pet)}｜产出 🪙{industryIncomePerHour(pet)}/时）
        </div>
        {INDUSTRIES.filter((ind) => industryLevel(pet, ind.id) > 0).length ===
        0 ? (
          <div className="text-[10px] text-gray-400">还没有产业</div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {INDUSTRIES.filter((ind) => industryLevel(pet, ind.id) > 0).map(
              (ind) => {
                const lv = industryLevel(pet, ind.id);
                const img = ind.useImage
                  ? INDUSTRY_IMAGES.hua
                  : ind.topImageKey &&
                      ind.topImageLevel != null &&
                      lv >= ind.topImageLevel
                    ? INDUSTRY_IMAGES[ind.topImageKey]
                    : undefined;
                return (
                  <span
                    key={ind.id}
                    className="flex items-center gap-0.5 rounded bg-gray-50 px-1 py-0.5 text-[10px]"
                  >
                    {img ? (
                      <img
                        src={img}
                        className="h-3.5 w-3.5 object-contain"
                        alt=""
                        draggable={false}
                      />
                    ) : (
                      <span>{ind.emoji}</span>
                    )}
                    <span>{ind.name}</span>
                    <span className="text-gray-400">×{lv}</span>
                  </span>
                );
              },
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-100 p-2 text-[10px] leading-relaxed text-gray-500">
        下载 {pet.stats.downloads}｜打工 {pet.stats.works}｜学习{' '}
        {pet.stats.studies}｜摸头 {pet.stats.pats}
        <br />
        喂养 {pet.stats.feeds}｜清洁 {pet.stats.cleans}｜玩耍 {pet.stats.plays}
        ｜就医 {pet.stats.heals}｜图鉴收集 {pet.collection.length}
      </div>
    </div>
  );

  const industryPanel = (
    <div className="space-y-1.5">
      <div className="text-[11px] text-gray-500">
        资产总额：🪙{assets(pet)}（金币 {Math.floor(pet.coin)} + 产业{' '}
        {pet.assetSpent}）
      </div>
      <div className="text-[10px] text-gray-400">
        每小时产出：🪙{industryIncomePerHour(pet)}
      </div>
      {INDUSTRIES.map((ind) => {
        if (!isIndustryUnlocked(pet, ind)) {
          return (
            <div
              key={ind.id}
              className="rounded-lg border border-gray-100 px-1.5 py-2 text-center text-[11px] text-gray-300"
            >
              ？？？
            </div>
          );
        }
        const level = industryLevel(pet, ind.id);
        const price = industryPrice(ind, level + 1);
        const income = industryIncome(ind, level);
        const nextIncome = industryIncome(ind, level + 1);
        const img = ind.useImage
          ? INDUSTRY_IMAGES.hua
          : ind.topImageKey &&
              ind.topImageLevel != null &&
              level >= ind.topImageLevel
            ? INDUSTRY_IMAGES[ind.topImageKey]
            : undefined;
        return (
          <div
            key={ind.id}
            className="rounded-lg border border-gray-100 px-1.5 py-1"
          >
            <div className="flex items-center gap-1 text-[11px]">
              {img ? (
                <img
                  src={img}
                  alt=""
                  className="h-4 w-4 object-contain"
                  draggable={false}
                />
              ) : (
                <span>{ind.emoji}</span>
              )}
              <span className="min-w-0 flex-1 truncate">{ind.name}</span>
              <span className="text-[10px] text-gray-400">Lv{level}</span>
            </div>
            <div className="text-[10px] text-gray-400">
              产出 🪙{income}/时 → 🪙{nextIncome}
            </div>
            <Button
              size="small"
              block
              type="primary"
              ghost
              disabled={pet.coin < price}
              onClick={() => {
                const r = pet.buyIndustry(ind.id);
                showToast(r.message ?? (r.ok ? '已购买' : '买不起'));
              }}
            >
              升级 🪙{price}
            </Button>
          </div>
        );
      })}
    </div>
  );

  const panelContent: Record<TopicKey, React.ReactNode> = {
    care: carePanel,
    shop: shopPanel,
    work: workPanel,
    study: studyPanel,
    dex: dexPanel,
    attr: attrPanel,
    industry: industryPanel,
  };
  const topicLabel = TOPICS.find((t) => t.key === view)?.label ?? '';

  if (!hydrated) return <div className="h-screen w-screen" />;

  // ---- 首次领养命名 ----
  if (!pet.adopted) {
    return (
      <div
        ref={adoptRef}
        className="flex h-screen w-screen flex-col items-center justify-center gap-2 bg-white/95 p-3"
      >
        <BananaSprite mood="happy" health="healthy" size={80} />
        <div className="text-sm font-medium">给新成员取个名字</div>
        <Input
          size="small"
          value={nameInput}
          maxLength={12}
          onChange={(e) => setNameInput(e.target.value)}
          onPressEnter={() => run(pet.adopt(nameInput), 'pat')}
        />
        <Button
          type="primary"
          size="small"
          block
          onClick={() => run(pet.adopt(nameInput), 'pat')}
        >
          领养
        </Button>
      </div>
    );
  }

  // 宠物块（右上角锚定，两种布局共用，位置/尺寸一致）
  const spriteBlock = (
    <div
      ref={spriteRef}
      className="relative shrink-0 select-none"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseDown={onSpritePointerDown}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      {floats.map((f) => (
        <div key={f.id} className="pet-coin-float">
          {f.text}
        </div>
      ))}
      <BananaSprite
        mood={mood}
        health={health}
        action={action}
        size={115}
        skinImage={skinImg}
        skinFilter={skinImg ? undefined : skin.filter}
        className="cursor-grab"
      />
      {huaFx && (
        <div key={huaFx} className="pet-hua-layer">
          <img
            src={INDUSTRY_IMAGES.hua}
            alt=""
            draggable={false}
            className="pet-hua-fx"
          />
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={`boom-${i}`}
              className="pet-hua-boom"
              style={{ animationDelay: `${0.48 + i * 0.24}s` }}
            >
              💥
            </span>
          ))}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span
              key={`coin-${i}`}
              className="pet-hua-coin"
              style={{
                left: `${38 + i * 5}%`,
                animationDelay: `${0.85 + i * 0.12}s`,
              }}
            >
              🪙
            </span>
          ))}
        </div>
      )}
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 top-0 z-50 w-[126px] rounded-lg border border-gray-200 bg-white/95 p-2 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between py-0.5 text-[11px]">
            <span>提示音</span>
            <Switch
              size="small"
              checked={pet.soundOn}
              onChange={(v) => pet.setSoundOn(v)}
            />
          </div>
          <div className="flex items-center justify-between py-0.5 text-[11px]">
            <span>短语</span>
            <Switch
              size="small"
              checked={pet.phraseOn}
              onChange={(v) => pet.setPhraseOn(v)}
            />
          </div>
          <div className="flex items-center justify-between py-0.5 text-[11px]">
            <span>上海话</span>
            <Switch
              size="small"
              checked={pet.shanghaiOn}
              onChange={(v) => pet.setShanghaiOn(v)}
            />
          </div>
        </div>
      )}
      {(mood === 'happy' || mood === 'sad') && health === 'healthy' && (
        <div className="pet-ambient">
          {mood === 'happy' ? (
            <>
              <span className="pet-flower" style={{ left: '-6%', top: '8%' }}>
                🌸
              </span>
              <span
                className="pet-flower"
                style={{ left: '84%', top: '0%', animationDelay: '0.8s' }}
              >
                🌼
              </span>
              <span
                className="pet-flower"
                style={{ left: '90%', top: '56%', animationDelay: '1.6s' }}
              >
                🌸
              </span>
              <span
                className="pet-flower"
                style={{ left: '-4%', top: '66%', animationDelay: '2.4s' }}
              >
                🌼
              </span>
              <span
                className="pet-flower"
                style={{ left: '42%', top: '-10%', animationDelay: '3.2s' }}
              >
                ✨
              </span>
            </>
          ) : (
            <>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <span
                  key={i}
                  className="pet-rain"
                  style={{
                    left: `${6 + i * 12}%`,
                    animationDelay: `${(i % 4) * 0.22}s`,
                  }}
                />
              ))}
            </>
          )}
        </div>
      )}
      {effect && (
        <div key={effect.id} className="pet-fx">
          {effect.kind === 'feed' || effect.kind === 'heal' ? (
            <span className="pet-fx-fall">{effect.emoji}</span>
          ) : effect.kind === 'play' ? (
            <span className="pet-fx-bounce">{effect.emoji}</span>
          ) : (
            <>
              <span className="pet-fx-clean">{effect.emoji}</span>
              <span className="pet-fx-bubble" style={{ left: '22%' }} />
              <span
                className="pet-fx-bubble"
                style={{ left: '46%', animationDelay: '0.15s' }}
              />
              <span
                className="pet-fx-bubble"
                style={{ left: '70%', animationDelay: '0.3s' }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );

  const toastEl = toast && (
    <div className="absolute bottom-1 left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-white">
      {toast}
    </div>
  );

  // 随机短语气泡（置顶居中、最高层级，避免被任务栏遮挡）
  const speechEl = speech && (
    <div className="pet-bubble absolute left-[calc(50%+50px)] top-1 z-50 max-w-[200px] -translate-x-1/2 text-center">
      {speech}
    </div>
  );

  // 皮肤解锁庆祝动画
  const celebEl = celeb && (
    <div key={celeb.key} className="pet-celeb">
      <div className="text-2xl leading-none">🎉</div>
      <div className="mt-0.5 text-[10px] text-gray-500">解锁新皮肤</div>
      <div className="mt-0.5 flex items-center gap-1">
        {skinImage(celeb.skinId) ? (
          <img
            src={skinImage(celeb.skinId)}
            alt=""
            className="h-8 w-8 object-contain"
          />
        ) : (
          <span className="text-xl leading-none">{celeb.emoji}</span>
        )}
        <span className="text-sm font-medium">{celeb.name}</span>
      </div>
    </div>
  );

  // 进行中任务：状态胶囊 + 进度条（贴在宠物脚下，彼此靠紧）
  const taskCluster =
    taskInfo && pet.task ? (
      <div
        ref={badgeRef}
        className="absolute bottom-1 right-2 z-30 flex flex-col items-end gap-0.5"
      >
        <div className="flex items-center gap-1 rounded-full border border-amber-300 bg-white/95 px-2 py-0.5 text-[10px] text-gray-700 shadow">
          <span>{taskInfo.emoji}</span>
          <span className="whitespace-nowrap">
            {taskInfo.name}·{taskInfo.kind}中…
          </span>
        </div>
        <Progress
          className="!m-0 !w-[110px]"
          percent={taskPct}
          showInfo={false}
          size="small"
          strokeColor={pet.task.type === 'work' ? '#52c41a' : '#722ed1'}
        />
      </div>
    ) : null;

  // ---- 面板态：面板在左，宠物在右上角不动；点空白关闭 ----
  if (view) {
    return (
      <div
        className="relative flex h-screen w-screen overflow-hidden pt-12"
        onClick={() => {
          setView(null);
          setMenuOpen(false);
        }}
      >
        <div
          className="ml-1 mr-1 flex min-h-0 min-w-0 flex-1 flex-col pb-1"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            ref={panelRef}
            className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-amber-100 bg-white/95 shadow-lg"
          >
            <div className="shrink-0 border-b border-gray-100 px-2 py-1 text-xs font-medium">
              {topicLabel}
            </div>
            <div className="pet-panel-scroll min-h-0 flex-1 overflow-y-auto p-2">
              {panelContent[view]}
            </div>
            <div className="shrink-0 border-t border-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
              🪙 {Math.floor(pet.coin)}｜{eduName(pet)}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end pr-2">
          {spriteBlock}
        </div>
        {taskCluster}
        {celebEl}
        {speechEl}
        {toastEl}
      </div>
    );
  }

  // ---- 常态：宠物右上角固定，圆按钮在下方右对齐 ----
  return (
    <div
      className="relative h-screen w-screen pt-12 pr-2"
      onClick={() => {
        if (menuOpen) setMenuOpen(false);
      }}
    >
      <div className="flex flex-col items-end">
        {spriteBlock}
        <div className="mt-1 flex flex-wrap justify-end gap-1" ref={buttonsRef}>
          {expanded &&
            TOPICS.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setView(t.key);
                  setExpanded(false);
                }}
                className="flex h-8 w-8 flex-col items-center justify-center rounded-full border border-amber-200 bg-white/95 text-[7px] leading-none text-gray-700 shadow-md transition hover:scale-105 hover:bg-amber-50"
                title={t.label}
              >
                <span className="text-xs">{t.emoji}</span>
                <span>{t.label}</span>
              </button>
            ))}
        </div>
      </div>

      {speechEl}
      {!speech && hover && !expanded && (
        <div className="pet-bubble absolute left-[calc(50%+50px)] top-1 z-50 -translate-x-1/2 whitespace-nowrap">
          {bubbleText(pet, pet.shanghaiOn)}
        </div>
      )}

      {taskCluster}
      {celebEl}
      {toastEl}
    </div>
  );
};

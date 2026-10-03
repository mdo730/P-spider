/**
 * 香蕉君精灵图（可插拔渲染层）。
 *
 * 对上层只暴露 state（mood/health/action）与皮肤滤镜；
 * 以后换成精灵图 / Rive / Live2D，只改这个文件，core 与 UI 不受影响。
 */

import clsx from 'clsx';
import React from 'react';
import banana from '../assets/banana.png';
import type { PetAction, PetHealth, PetMood } from '../types';
import './pet.css';

interface BananaSpriteProps {
  mood: PetMood;
  health: PetHealth;
  action?: PetAction;
  size?: number;
  /** 皮肤整图（有则替换母图） */
  skinImage?: string;
  /** 皮肤 CSS filter（无整图时的调色兜底，叠加在动画滤镜之上） */
  skinFilter?: string;
  onClick?: () => void;
  className?: string;
}

const ACTION_CLASS: Partial<Record<PetAction, string>> = {
  pat: 'pet-act-pat',
  eat: 'pet-act-eat',
  clean: 'pet-act-clean',
  play: 'pet-act-play',
  heal: 'pet-act-heal',
  work: 'pet-act-work',
  study: 'pet-act-study',
  jump: 'pet-act-jump',
};

export const BananaSprite: React.FC<BananaSpriteProps> = ({
  health,
  action = 'idle',
  size = 160,
  skinImage,
  skinFilter,
  onClick,
  className,
}) => {
  // 身体：生病/重症躺倒；其余一律平静呼吸（开心/失落靠外层特效表现）
  const stateClass =
    health === 'critical'
      ? 'pet-critical'
      : health === 'sick'
        ? 'pet-sick'
        : 'pet-idle';

  return (
    <span
      className={clsx(
        'relative inline-block',
        onClick && 'cursor-pointer',
        className,
      )}
      style={skinFilter ? { filter: skinFilter } : undefined}
      onClick={onClick}
    >
      <img
        src={skinImage ?? banana}
        alt="香蕉君"
        draggable={false}
        style={{ width: size, height: size, objectFit: 'contain' }}
        className={clsx(
          'pet-sprite',
          stateClass,
          action !== 'idle' && ACTION_CLASS[action],
        )}
      />
      {health !== 'healthy' && (
        <span
          className={clsx(
            'pet-sick-mask',
            health === 'critical' && 'pet-sick-mask--strong',
          )}
        />
      )}
    </span>
  );
};

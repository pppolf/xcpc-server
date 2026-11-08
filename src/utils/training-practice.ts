import type { ITraining } from '../models/training.model';
import { parseCWNUOJContestUrl } from './cwnuoj-training';

export const parseTrainingPracticeUrl = (value: unknown): string | null => {
  if (value === null || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value === 'string' && value.length <= 2048 && /^https?:\/\//i.test(value.trim())) {
    const url = new URL(value.trim());
    if (url.hostname && !url.username && !url.password) return url.href;
  }
  throw new Error('补题链接须为有效的 HTTP 或 HTTPS 地址');
};

type PracticeTraining = Pick<ITraining,
  'platform' | 'practiceUrl' | 'vjudgeContestId' | 'nowcoderContestId' |
  'cwnuojContestId' | 'cwnuojContestUrl' | 'vpContestUrl'>;

export const resolveTrainingPracticeUrl = (training: PracticeTraining): string | null => {
  try {
    if (training.practiceUrl) return parseTrainingPracticeUrl(training.practiceUrl);
    if (training.platform === 'VJUDGE' && /^\d+$/.test(training.vjudgeContestId || '')) {
      return `https://vjudge.net/contest/${training.vjudgeContestId}`;
    }
    if (training.platform === 'NOWCODER') {
      const id = training.nowcoderContestId || training.vjudgeContestId;
      return id && /^\d+$/.test(id) ? `https://ac.nowcoder.com/acm/contest/${id}` : null;
    }
    if (training.platform === 'CWNUOJ') {
      const id = training.cwnuojContestId;
      if (id && /^[a-f\d]{24}$/i.test(id)) return `https://oj.cwnupaa.com/contest/${id}`;
      return parseCWNUOJContestUrl(training.cwnuojContestUrl).contestUrl;
    }
    if (training.platform === 'VP_SYSTEM' && training.vpContestUrl) {
      return parseTrainingPracticeUrl(training.vpContestUrl);
    }
    return null;
  } catch {
    return null;
  }
};

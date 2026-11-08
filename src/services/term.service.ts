import axios from 'axios';
import { Types } from 'mongoose';
import GlobalSetting from '../models/global-setting.model';

const CATALOG_KEY = 'TRAINING_TERMS';
export interface TrainingTerm {
  _id: string;
  termName: string;
  startTime: string;
  websiteTermId: string | null;
  nextStartTime?: string | null;
}
interface TermCatalog {
  terms: TrainingTerm[];
  lastSyncedAt: string | null;
}
export class TermError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const readCatalog = async () => {
  const document = await GlobalSetting.findOne({ key: CATALOG_KEY }).lean();
  const stored: TermCatalog = document?.value ?? { terms: [], lastSyncedAt: null };
  // Older catalogs may contain end dates. Only semester starts define boundaries.
  const value: TermCatalog = {
    lastSyncedAt: stored.lastSyncedAt,
    terms: stored.terms.map((term) => ({
      _id: term._id,
      termName: term.termName,
      startTime: term.startTime,
      websiteTermId: term.websiteTermId,
    })),
  };
  return { document, value };
};
const sorted = (terms: TrainingTerm[]) => [...terms].sort((a, b) => b.startTime.localeCompare(a.startTime));
const presentCatalog = (value: TermCatalog) => ({
  ...value,
  terms: sorted(value.terms).map((term, index, terms) => ({
    ...term,
    nextStartTime: index > 0 ? terms[index - 1].startTime : null,
  })),
});
export const getTermCatalog = async (): Promise<TermCatalog> => {
  const { value } = await readCatalog();
  return presentCatalog(value);
};

// One catalog document makes a complete sync atomic, including on standalone MongoDB.
const writeCatalog = async (previous: Awaited<ReturnType<typeof readCatalog>>, value: TermCatalog) => {
  if (!previous.document) {
    try {
      await GlobalSetting.create({ key: CATALOG_KEY, value, description: '训练学期与协会官网同步信息' });
    } catch (error: any) {
      if (error.code === 11000) throw new TermError('学期信息已被其他管理员更新，请刷新后重试', 409);
      throw error;
    }
  } else {
    const updated = await GlobalSetting.findOneAndUpdate(
      { _id: previous.document._id, __v: previous.document.__v },
      { $set: { value }, $inc: { __v: 1 } },
      { new: true },
    );
    if (!updated) throw new TermError('学期信息已被其他管理员更新，请刷新后重试', 409);
  }
  return presentCatalog(value);
};

const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const termFields = (input: Record<string, unknown>) => {
  const termName = typeof input.termName === 'string' ? input.termName.trim() : '';
  const years = /^([1-9]\d{3})-([1-9]\d{3})-[12]$/.exec(termName);
  if (!years || Number(years[2]) !== Number(years[1]) + 1) {
    throw new TermError('学期名称应为连续学年，例如 2026-2027-1 或 2026-2027-2');
  }
  if (!validDate(input.startTime)) throw new TermError('请选择有效的开始日期');
  return { termName, startTime: input.startTime };
};
const validateCatalog = (terms: TrainingTerm[]) => {
  if (terms.length > 1000) throw new TermError('学期数量超过上限');
  const names = new Set<string>();
  const websiteIds = new Set<string>();
  const chronological = [...terms].sort((a, b) => a.startTime.localeCompare(b.startTime));
  for (let i = 0; i < chronological.length; i++) {
    const term = chronological[i];
    if (names.has(term.termName)) throw new TermError(`学期 ${term.termName} 已存在`);
    names.add(term.termName);
    if (term.websiteTermId) {
      if (websiteIds.has(term.websiteTermId)) throw new TermError('官网学期 ID 重复');
      websiteIds.add(term.websiteTermId);
    }
    const previous = chronological[i - 1];
    if (previous && previous.startTime === term.startTime) {
      throw new TermError(`学期 ${previous.termName} 与 ${term.termName} 不能使用相同的开始日期`);
    }
  }
};

export const saveTerm = async (id: string | undefined, input: Record<string, unknown>) => {
  const fields = termFields(input);
  const previous = await readCatalog();
  const terms = previous.value.terms.map((term) => ({ ...term }));
  if (id) {
    const term = terms.find((term) => term._id === id);
    if (!term) throw new TermError('学期不存在', 404);
    if (fields.termName !== term.termName) throw new TermError('已创建的学期名称不能修改');
    Object.assign(term, fields);
  } else {
    terms.push({ _id: new Types.ObjectId().toHexString(), ...fields, websiteTermId: null });
  }
  validateCatalog(terms);
  return writeCatalog(previous, { ...previous.value, terms });
};

export const syncAssociationTerms = async () => {
  let body;
  try {
    const response = await axios.get('https://www.cwnupaa.com/api/common/terms', {
      timeout: 15000,
      maxRedirects: 0,
      headers: { Accept: 'application/json' },
    });
    body = response.data;
  } catch {
    throw new TermError('协会官网学期信息暂时无法读取，原有学期未更改', 502);
  }
  if (body?.code !== 200 || !Array.isArray(body.data) || !body.data.length || body.data.length > 1000) {
    throw new TermError('协会官网学期信息格式异常，原有学期未更改', 502);
  }
  let incoming: TrainingTerm[];
  try {
    incoming = body.data.map((row: any) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error();
      const websiteTermId =
        typeof row.termId === 'number' && Number.isSafeInteger(row.termId) && row.termId > 0
          ? String(row.termId)
          : typeof row.termId === 'string' && /^[1-9]\d{0,18}$/.test(row.termId)
            ? row.termId
            : '';
      if (!websiteTermId) throw new Error();
      return { _id: '', ...termFields(row), websiteTermId };
    });
    validateCatalog(incoming);
  } catch {
    throw new TermError('协会官网学期名称、日期或编号异常，原有学期未更改', 502);
  }

  const previous = await readCatalog();
  const terms = previous.value.terms.map((term) => ({ ...term }));
  let addedCount = 0;
  let updatedCount = 0;
  for (const source of incoming) {
    const byId = terms.find((term) => term.websiteTermId === source.websiteTermId);
    const byName = terms.find((term) => term.termName === source.termName);
    if (
      (byId && byName && byId._id !== byName._id) ||
      (byName?.websiteTermId && byName.websiteTermId !== source.websiteTermId)
    ) {
      throw new TermError(`官网学期 ${source.termName} 与已有学期冲突，请先核对设置`, 409);
    }
    const existing = byId || byName;
    if (existing) {
      if (
        existing.termName !== source.termName ||
        existing.startTime !== source.startTime ||
        existing.websiteTermId !== source.websiteTermId
      )
        updatedCount++;
      Object.assign(existing, source, { _id: existing._id });
    } else {
      terms.push({ ...source, _id: new Types.ObjectId().toHexString() });
      addedCount++;
    }
  }
  validateCatalog(terms);
  const catalog = await writeCatalog(previous, { terms, lastSyncedAt: new Date().toISOString() });
  return { ...catalog, addedCount, updatedCount, syncedCount: incoming.length };
};

export const validateTrainingTermId = async (value: unknown) => {
  if (value === null || value === '' || value === undefined) throw new TermError('请选择所属计分学期');
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw new TermError('请选择有效的学期');
  const id = value.toLowerCase();
  if (!(await getTermCatalog()).terms.some((term) => term._id === id))
    throw new TermError('所选学期不存在，请刷新后重新选择');
  return id;
};

const termBounds = (term: TrainingTerm, terms: TrainingTerm[]) => {
  const chronological = [...terms].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const next = chronological.find((candidate) => candidate.startTime > term.startTime);
  return {
    startTime: {
      $gte: new Date(`${term.startTime}T00:00:00+08:00`),
      ...(next ? { $lt: new Date(`${next.startTime}T00:00:00+08:00`) } : {}),
    },
  };
};
export const resolveTermAtTime = (value: string | Date, terms: TrainingTerm[]) => {
  const start = new Date(value).getTime();
  if (!Number.isFinite(start)) return undefined;
  return sorted(terms).find((term) => start >= new Date(`${term.startTime}T00:00:00+08:00`).getTime());
};
export const resolveTrainingTerm = (training: any, terms: TrainingTerm[]) => {
  if (training.termId) return terms.find((term) => term._id === String(training.termId));
  return resolveTermAtTime(training.startTime, terms);
};
export const buildTrainingTermFilter = (value: unknown, terms: TrainingTerm[]) => {
  if (value === undefined || value === '') return {};
  if (value === 'unassigned') {
    return { termId: null, ...(terms.length ? { $nor: terms.map((term) => termBounds(term, terms)) } : {}) };
  }
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw new TermError('学期筛选参数不正确');
  const term = terms.find((term) => term._id === value.toLowerCase());
  if (!term) throw new TermError('所选学期不存在，请刷新后重新选择');
  return { $or: [{ termId: term._id }, { termId: null, ...termBounds(term, terms) }] };
};

// A date without a time refers to a whole calendar day in Asia/Shanghai.
export const buildTrainingDateFilter = (query: Record<string, unknown>) => {
  const parseBound = (value: unknown, end: boolean) => {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string') throw new Error('起止时间格式不正确');
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const date = new Date(`${value}T00:00:00+08:00`);
      if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10) !== value) {
        throw new Error('起止时间格式不正确');
      }
      return new Date(date.getTime() + (end ? 86400000 : 0));
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
      throw new Error('起止时间请使用带时区的 ISO 时间或 YYYY-MM-DD');
    }
    const calendarDay = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== value.slice(0, 10)
      || Number(value.slice(11, 13)) > 23) {
      throw new Error('起止时间格式不正确');
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('起止时间格式不正确');
    return date;
  };
  const start = parseBound(query.startDate, false);
  const end = parseBound(query.endDate, true);
  const endExclusive = typeof query.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.endDate);
  if (start && end && (endExclusive ? start >= end : start > end)) throw new Error('起始时间不能晚于截止时间');
  if (!start && !end) return {};
  return { startTime: { ...(start ? { $gte: start } : {}), ...(end ? (endExclusive ? { $lt: end } : { $lte: end }) : {}) } };
};

export const buildTrainingFilter = (query: Record<string, unknown>) => {
  const dateFilter = buildTrainingDateFilter(query);
  if (query.type === undefined || query.type === '') return dateFilter;
  if (query.type !== 'TRAINING' && query.type !== 'ASSESSMENT') throw new Error('训练类型不正确');
  return { ...dateFilter, type: query.type };
};

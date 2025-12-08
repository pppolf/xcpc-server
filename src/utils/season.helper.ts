export const getSeasonDiff = (currentSeason: string, targetSeason: string): number => {
  const currentStartYear = parseInt(currentSeason.split('-')[0]);
  const targetStartYear = parseInt(targetSeason.split('-')[0]);
  return Math.max(0, currentStartYear - targetStartYear);
};
import User from '../models/user.model';
import { getTrainingTargetCount } from './training-target';
import { resolveTrainingPracticeUrl } from './training-practice';
import { getTermCatalog, resolveTrainingTerm, resolveTermAtTime, TrainingTerm } from '../services/term.service';

// Apply the local setter exemption only to API output. Stored ranklists remain
// the actual imported/synced results, so removing a setter restores their result.
export const presentTrainings = async (documents: any[], catalogTerms?: TrainingTerm[]) => {
  const terms = catalogTerms ?? (await getTermCatalog()).terms;
  const trainings = documents.map(document => document.toObject?.() ?? document);
  const setterIds = [...new Set<string>(trainings.flatMap(training =>
    (training.problemSetterIds || []).map((id: any) => String(id))))];
  const users = setterIds.length ? await User.find({ _id: { $in: setterIds } })
    .select('realName studentId status trainingTeam ojInfo').lean() : [];
  const userMap = new Map(users.map(user => [String(user._id), user]));

  return trainings.map(training => {
    const term = resolveTrainingTerm(training, terms);
    const eventTerm = resolveTermAtTime(training.startTime, terms);
    const ids: string[] = (training.problemSetterIds || []).map((id: any) => String(id));
    const setters = ids.flatMap(id => {
      const user = userMap.get(id);
      return user ? [user] : [];
    });
    const ranklist = (training.ranklist || []).map((row: any) => ({ ...row }));
    for (const user of setters) {
      const index = ranklist.findIndex((row: any) => String(row.userId) === String(user._id));
      const original = index >= 0 ? ranklist[index] : {};
      const problemStatus: Record<string, any> = {};
      for (let problemIndex = 0; problemIndex < training.problemCount; problemIndex++) {
        const fullScore = training.associationBoardProblems?.[problemIndex]?.score;
        problemStatus[String(problemIndex)] = { accepted: true, time: 0, status: 'AC',
          ...(Number.isFinite(fullScore) ? { score: fullScore, fullScore } : {}) };
      }
      const row = { ...original, userId: user._id, realName: user.realName,
        trainingTeam: user.trainingTeam, targetCount: getTrainingTargetCount(training, user),
        vjudgeHandle: original.vjudgeHandle || (training.platform === 'NOWCODER' ? user.ojInfo?.nc
          : training.platform === 'CWNUOJ' ? user.ojInfo?.cwnuoj
            : training.platform === 'VJUDGE' ? user.ojInfo?.vjudge : user.studentId) || '',
        cwnuojUid: original.cwnuojUid || user.ojInfo?.cwnuoj || '',
        isProblemSetter: true, solved: training.problemCount, penalty: 0,
        isAK: true, isPassed: true, problemStatus,
        // Do not present a local exemption as a score/rank from the official board.
        sourceName: '', sourceRank: undefined, sourceScore: undefined };
      if (index >= 0) ranklist[index] = row;
      else ranklist.push(row);
    }
    return { ...training, resolvedPracticeUrl: resolveTrainingPracticeUrl(training), termId: training.termId || null, resolvedTermId: term?._id || null,
      termName: term?.termName || null, termAssignment: training.termId ? 'manual' : term ? 'automatic' : 'unassigned',
      eventTermId: eventTerm?._id || null, eventTermName: eventTerm?.termName || null,
      problemSetterIds: ids, problemSetters: setters.map((user: any) => ({
      _id: String(user._id), realName: user.realName, studentId: user.studentId, status: user.status,
    })), ranklist };
  });
};

export const presentTraining = async (document: any) => (await presentTrainings([document]))[0];

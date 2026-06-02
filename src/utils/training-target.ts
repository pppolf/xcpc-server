export const getTrainingTargetCount = (trainingDoc: any, user: any) => {
  if (user?.trainingTeam === 'First') {
    return Number(trainingDoc.targetCountFirst ?? trainingDoc.targetCount) || 0;
  }

  if (user?.trainingTeam === 'Second') {
    return Number(trainingDoc.targetCountSecond ?? trainingDoc.targetCount) || 0;
  }

  return Number(trainingDoc.targetCount) || 0;
};

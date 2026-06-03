import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { initGlobalConfig } from '../services/config.service';
import { recalculateAllContestRatings } from '../services/rating.service';

const DRY_RUN = process.argv.includes('--dry-run');

const main = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(mongoUri);
  await initGlobalConfig();

  const results = await recalculateAllContestRatings(DRY_RUN);
  const changed = results.filter(
    (item) => item.oldContest !== item.newContest || item.oldRating !== item.newRating,
  );

  console.log(`[ContestRating] Mode: ${DRY_RUN ? 'dry-run' : 'update'}`);
  console.log(`[ContestRating] Users checked: ${results.length}`);
  console.log(`[ContestRating] Users changed: ${changed.length}`);

  if (changed.length > 0) {
    console.table(
      changed.slice(0, 20).map((item) => ({
        user: item.realName,
        oldContest: item.oldContest,
        newContest: item.newContest,
        oldRating: item.oldRating,
        newRating: item.newRating,
      })),
    );
  }

  if (DRY_RUN) {
    console.log('[ContestRating] Dry run only. No users were updated.');
  }
};

main()
  .catch((error) => {
    console.error('[ContestRating] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });

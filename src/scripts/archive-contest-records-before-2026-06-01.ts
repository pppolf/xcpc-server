import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import ContestRecord from '../models/contest-record.model';

const CUTOFF = new Date('2026-05-31T16:00:00.000Z'); // 2026-06-01 00:00:00 Asia/Shanghai
const DRY_RUN = process.argv.includes('--dry-run');

const main = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(mongoUri);

  const filter = {
    contestDate: { $lt: CUTOFF },
    isArchived: { $ne: true },
  };

  const records = await ContestRecord.find(filter).select('_id season name contestDate').lean();

  console.log(`[Patch] Cutoff: ${CUTOFF.toISOString()} (2026-06-01 00:00:00 Asia/Shanghai)`);
  console.log(`[Patch] Matched records: ${records.length}`);

  if (records.length > 0) {
    console.table(
      records.slice(0, 10).map((record) => ({
        id: record._id.toString(),
        season: record.season,
        name: record.name,
        contestDate: record.contestDate,
      })),
    );
  }

  if (DRY_RUN) {
    console.log('[Patch] Dry run only. No records were updated.');
    return;
  }

  if (records.length === 0) {
    console.log('[Patch] Nothing to archive.');
    return;
  }

  const archivedAt = new Date();
  const result = await ContestRecord.bulkWrite(
    records.map((record) => ({
      updateOne: {
        filter: { _id: record._id },
        update: {
          $set: {
            isArchived: true,
            archivedAt,
            archivedSeason: record.season,
          },
        },
      },
    })),
  );

  console.log(`[Patch] Archived records: ${result.modifiedCount}`);
};

main()
  .catch((error) => {
    console.error('[Patch] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });

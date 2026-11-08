import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });
import mongoose from 'mongoose';
import { syncAssociationTerms, TermError } from '../services/term.service';

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error('Database configuration missing');
  await mongoose.connect(process.env.MONGO_URI);
  const result = await syncAssociationTerms();
  console.log(
    JSON.stringify({
      syncedCount: result.syncedCount,
      addedCount: result.addedCount,
      updatedCount: result.updatedCount,
      lastSyncedAt: result.lastSyncedAt,
    }),
  );
};
main()
  .catch((error) => {
    console.error(error instanceof TermError ? error.message : '学期同步失败，请检查服务器配置');
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

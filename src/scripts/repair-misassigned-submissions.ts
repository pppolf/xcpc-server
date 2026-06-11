import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Submission from '../models/submission.model';
import User from '../models/user.model';

type Platform = 'CodeForces' | 'AtCoder' | 'Luogu' | 'NowCoder' | 'CWNUOJ';

const PLATFORM_TO_OJ_FIELD: Record<Platform, string> = {
  CodeForces: 'cf',
  AtCoder: 'at',
  Luogu: 'lg',
  NowCoder: 'nc',
  CWNUOJ: 'cwnuoj',
};

const args = process.argv.slice(2);

const toEnvName = (name: string) => `REPAIR_${name.replace(/-/g, '_').toUpperCase()}`;

const getArg = (name: string) => {
  const envValue = process.env[toEnvName(name)];
  if (envValue) return envValue;

  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = args.indexOf(`--${name}`);
  if (index >= 0) return args[index + 1];

  return undefined;
};

const hasFlag = (name: string) => args.includes(`--${name}`);

const usage = () => {
  console.log(`
Repair submissions that were synced with one member's OJ account but written to another user.

Required:
  --from <id|username|studentId>   Wrong owner, usually the admin account
  --to <id|username|studentId>     Correct owner, the member whose OJ account was synced
  --platform <platform>            CodeForces | AtCoder | Luogu | NowCoder | CWNUOJ

Optional:
  --since <ISO date>               Only repair records created at/after this time
  --until <ISO date>               Only repair records created before this time
  --problem-id <problemId>         Only repair one problem id
  --remote-id <remoteId>           Only repair one remote submission id
  --apply                          Actually write changes. Without this, dry-run only.

Example dry-run:
  npx ts-node src/scripts/repair-misassigned-submissions.ts --from=20230001 --to=20230002 --platform=CodeForces --since=2026-06-11T00:00:00+08:00

Example apply:
  npx ts-node src/scripts/repair-misassigned-submissions.ts --from=20230001 --to=20230002 --platform=CodeForces --since=2026-06-11T00:00:00+08:00 --apply

PowerShell env style:
  $env:REPAIR_FROM='20230001'; $env:REPAIR_TO='20230002'; $env:REPAIR_PLATFORM='CodeForces'; npx ts-node src/scripts/repair-misassigned-submissions.ts
`);
};

const findUser = async (locator: string) => {
  const or: any[] = [{ username: locator }, { studentId: locator }];
  if (mongoose.Types.ObjectId.isValid(locator)) {
    or.unshift({ _id: locator });
  }

  return User.findOne({ $or: or });
};

const parseDate = (value: string | undefined, name: string) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid --${name}: ${value}`);
  }
  return date;
};

const main = async () => {
  if (hasFlag('help') || hasFlag('h')) {
    usage();
    return;
  }

  const fromLocator = getArg('from');
  const toLocator = getArg('to');
  const platform = getArg('platform') as Platform | undefined;
  const since = parseDate(getArg('since'), 'since');
  const until = parseDate(getArg('until'), 'until');
  const problemId = getArg('problem-id');
  const remoteId = getArg('remote-id');
  const apply = hasFlag('apply');

  if (!fromLocator || !toLocator || !platform) {
    usage();
    throw new Error('--from, --to and --platform are required');
  }

  if (!Object.prototype.hasOwnProperty.call(PLATFORM_TO_OJ_FIELD, platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI is required');

  await mongoose.connect(mongoUri);

  const [fromUser, toUser] = await Promise.all([findUser(fromLocator), findUser(toLocator)]);
  if (!fromUser) throw new Error(`Cannot find --from user: ${fromLocator}`);
  if (!toUser) throw new Error(`Cannot find --to user: ${toLocator}`);

  const ojField = PLATFORM_TO_OJ_FIELD[platform];
  const targetHandle = (toUser.ojInfo as any)?.[ojField];
  if (!targetHandle) {
    throw new Error(`${toUser.realName} has no ${platform} handle configured`);
  }

  const createdAtFilter: Record<string, Date> = {};
  if (since) createdAtFilter.$gte = since;
  if (until) createdAtFilter.$lt = until;

  const filter: any = {
    userId: fromUser._id,
    platform,
    ...(problemId && { problemId }),
    ...(remoteId && { remoteId }),
    ...(Object.keys(createdAtFilter).length > 0 && { createdAt: createdAtFilter }),
  };

  const candidates = await Submission.find(filter).sort({ createdAt: 1 });

  let moved = 0;
  let deletedAsDuplicate = 0;
  const samples: Array<{
    action: string;
    problemId: string;
    remoteId: string;
    solveTime: string;
    createdAt: string;
  }> = [];

  for (const submission of candidates) {
    const duplicate = await Submission.findOne({
      userId: toUser._id,
      platform,
      problemId: submission.problemId,
    });

    const action = duplicate ? 'delete duplicate from wrong user' : 'move to target user';
    if (samples.length < 20) {
      samples.push({
        action,
        problemId: submission.problemId,
        remoteId: submission.remoteId,
        solveTime: submission.solveTime?.toISOString?.() || String(submission.solveTime),
        createdAt: (submission as any).createdAt?.toISOString?.() || String((submission as any).createdAt),
      });
    }

    if (!apply) continue;

    if (duplicate) {
      await Submission.deleteOne({ _id: submission._id });
      deletedAsDuplicate++;
    } else {
      await Submission.updateOne({ _id: submission._id }, { $set: { userId: toUser._id } });
      moved++;
    }
  }

  console.log(`[RepairSubmissions] Mode: ${apply ? 'apply' : 'dry-run'}`);
  console.log(`[RepairSubmissions] Wrong owner: ${fromUser.realName} (${fromUser.username}, ${fromUser.studentId})`);
  console.log(`[RepairSubmissions] Target owner: ${toUser.realName} (${toUser.username}, ${toUser.studentId})`);
  console.log(`[RepairSubmissions] Platform: ${platform}, target handle: ${targetHandle}`);
  if (since) console.log(`[RepairSubmissions] Since: ${since.toISOString()}`);
  if (until) console.log(`[RepairSubmissions] Until: ${until.toISOString()}`);
  if (problemId) console.log(`[RepairSubmissions] ProblemId: ${problemId}`);
  if (remoteId) console.log(`[RepairSubmissions] RemoteId: ${remoteId}`);
  console.log(`[RepairSubmissions] Candidates: ${candidates.length}`);

  if (samples.length > 0) {
    console.table(samples);
  }

  if (apply) {
    console.log(`[RepairSubmissions] Moved: ${moved}`);
    console.log(`[RepairSubmissions] Deleted duplicates from wrong owner: ${deletedAsDuplicate}`);
  } else {
    const duplicateCount = await Promise.all(
      candidates.map((submission) =>
        Submission.exists({ userId: toUser._id, platform, problemId: submission.problemId }),
      ),
    ).then((items) => items.filter(Boolean).length);
    console.log(`[RepairSubmissions] Would move: ${candidates.length - duplicateCount}`);
    console.log(`[RepairSubmissions] Would delete duplicates from wrong owner: ${duplicateCount}`);
    console.log('[RepairSubmissions] Dry run only. Add --apply to write changes.');
  }
};

main()
  .catch((error) => {
    console.error('[RepairSubmissions] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });

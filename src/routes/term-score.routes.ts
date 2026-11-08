import { Router, type Request, type Response } from 'express';
import User from '../models/user.model';
import TermScoreReview, { type ReviewStatus } from '../models/term-score-review.model';
import { authMiddleware } from '../middlewares/auth.middleware';
import { isSystemAccount } from '../services/auth.service';
import {
  getScoreEvent, loadTermScores, rankTermScores, selectScoreTerm, setMainAssessment,
} from '../services/term-score.service';
import { TermError } from '../services/term.service';
import { eventEnded, PRACTICE_TARGET, SCORE_WEIGHTS, scoreIsCount } from '../utils/term-score';
import { fail, success } from '../utils/response';

const router = Router();
const adminRoles = ['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach'];
const memberFields = 'realName studentId trainingTeam ojInfo.cwnuoj username role status';
const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const activeMembers = { status: 'Active', role: { $ne: 'Teacher' } };

router.use(authMiddleware);

const scoreRoute = (admin: boolean, handler: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response) => {
    try {
      const id = req.user?.userId;
      const actor = isId(id) ? await User.findById(id).select('role status username').lean() : null;
      if (!actor) {
        fail(res, '登录账号不存在', 401, 401);
        return;
      }
      if (admin ? actor.status !== 'Active' || !adminRoles.includes(actor.role)
        : actor.role === 'Teacher' || isSystemAccount(actor.username)) {
        fail(res, '无权查看此成绩', 403, 403);
        return;
      }
      await handler(req, res);
    } catch (error) {
      if (error instanceof TermError) {
        fail(res, error.message, error.status, error.status);
      } else {
        console.error('[Term Score]', error);
        fail(res, '成绩服务暂时无法处理请求', 500, 500);
      }
    }
  };

router.get('/me', scoreRoute(false, async (req, res) => {
  const { terms, term } = await selectScoreTerm(req.query.termId);
  const member = await User.findById(req.user!.userId).select(memberFields).lean();
  if (!member) throw new TermError('队员不存在', 404);
  const scores = term ? await loadTermScores(term, terms, [member]) : null;
  success(res, {
    terms, term, weights: SCORE_WEIGHTS, practiceTarget: PRACTICE_TARGET, detail: scores?.details[0] ?? null,
  });
}));

router.get('/manage', scoreRoute(true, async (req, res) => {
  const { terms, term } = await selectScoreTerm(req.query.termId);
  const users = term ? await User.find(activeMembers).select(memberFields).lean() : [];
  const scores = term ? await loadTermScores(term, terms, users.filter(user => !isSystemAccount(user.username))) : null;
  success(res, {
    terms, term, weights: SCORE_WEIGHTS, practiceTarget: PRACTICE_TARGET,
    assessments: scores?.assessments ?? [], mainAssessmentId: scores?.mainAssessmentId ?? null,
    rows: scores ? rankTermScores(scores.details) : [],
  });
}));

const getManagedMember = async (id: unknown) => {
  if (!isId(id)) throw new TermError('队员编号不正确');
  const member = await User.findOne({ _id: id, ...activeMembers }).select(memberFields).lean();
  if (!member || isSystemAccount(member.username)) throw new TermError('在役队员不存在', 404);
  return member;
};

router.get('/manage/:userId', scoreRoute(true, async (req, res) => {
  const { terms, term } = await selectScoreTerm(req.query.termId);
  const member = await getManagedMember(req.params.userId);
  const scores = term ? await loadTermScores(term, terms, [member]) : null;
  success(res, scores?.details[0] ?? null);
}));

router.put('/assessment', scoreRoute(true, async (req, res) => {
  const { term, terms } = await selectScoreTerm(req.body?.termId);
  const eventId = req.body?.eventId;
  if (!req.body?.termId || !term || !isId(eventId)) throw new TermError('请选择计分学期和统一考核赛');
  const event = await getScoreEvent(term, terms, eventId);
  if (event?.type !== 'ASSESSMENT') throw new TermError('所选考核赛不属于该计分学期');
  await setMainAssessment(term._id, String(event._id));
  success(res, { eventId: String(event._id) });
}));

router.put('/manage/:userId/reviews/:itemId', scoreRoute(true, async (req, res) => {
  const { terms, term } = await selectScoreTerm(req.body?.termId);
  if (!req.body?.termId || !term) throw new TermError('请选择要核验的学期');
  const member = await getManagedMember(req.params.userId);
  const itemId = req.params.itemId;
  const practice = itemId === 'practice';
  const body = req.body ?? {};
  if (!practice && !isId(itemId)) throw new TermError('成绩项目不正确');
  const event = practice ? null : await getScoreEvent(term, terms, itemId as string);
  if (!practice && !event) throw new TermError('该训练不属于所选学期');
  const assessment = event?.type === 'ASSESSMENT';
  const key = { termId: term._id, userId: member._id, itemId: practice ? 'practice' : String(event!._id) };
  if (body.status === null) {
    await TermScoreReview.deleteOne(key);
    success(res, null);
    return;
  }
  if (event && !eventEnded(event, Date.now())) throw new TermError('该场结束后可核验成绩');
  const allowed: ReviewStatus[] = practice ? ['scored', 'invalidated']
    : assessment ? ['scored', 'absent', 'excused', 'exempt', 'makeup']
      : ['scored', 'absent', 'excused', 'exempt'];
  if (!allowed.includes(body.status)) throw new TermError('核验状态无效');
  const scored = body.status === 'scored' || body.status === 'makeup';
  if (scored && (!scoreIsCount(body.solved) || (event && body.status !== 'makeup' && body.solved > event.problemCount))) {
    throw new TermError('请输入有效的通过题数');
  }
  if (assessment && scored &&
    (typeof body.penalty !== 'number' || !Number.isFinite(body.penalty) || body.penalty < 0)) {
    throw new TermError('请输入有效的累计罚时（秒）');
  }
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 200)) {
    throw new TermError('核验备注限 200 字');
  }
  const values = {
    status: body.status, updatedBy: req.user!.userId, note: body.note?.trim() || '',
    ...(scored ? { solved: body.solved } : {}),
    ...(assessment && scored ? { penalty: body.penalty } : {}),
  };
  await TermScoreReview.updateOne(key, {
    $set: values,
    $unset: {
      ...(scored ? {} : { solved: 1 }),
      ...(assessment && scored ? {} : { penalty: 1 }),
    },
  }, { upsert: true });
  success(res, null);
}));

export default router;

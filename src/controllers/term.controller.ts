import { Request, Response } from 'express';
import { getTermCatalog, saveTerm, syncAssociationTerms, TermError } from '../services/term.service';
import { success, fail } from '../utils/response';

const respondError = (res: Response, error: unknown) => {
  const status = error instanceof TermError ? error.status : 500;
  return fail(
    res,
    error instanceof TermError ? error.message : '学期信息操作失败，请稍后重试',
    status,
    status,
  );
};
export const getTerms = async (_req: Request, res: Response) => {
  try {
    success(res, await getTermCatalog());
  } catch (error) {
    respondError(res, error);
  }
};
export const createTerm = async (req: Request, res: Response) => {
  try {
    success(res, await saveTerm(undefined, req.body ?? {}), '学期已添加');
  } catch (error) {
    respondError(res, error);
  }
};
export const updateTerm = async (req: Request, res: Response) => {
  try {
    success(res, await saveTerm(req.params.id as string, req.body ?? {}), '学期已更新');
  } catch (error) {
    respondError(res, error);
  }
};
export const syncTerms = async (_req: Request, res: Response) => {
  try {
    success(res, await syncAssociationTerms(), '官网学期同步完成');
  } catch (error) {
    respondError(res, error);
  }
};

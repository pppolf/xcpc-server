import { Router } from 'express';
import { getTrainings, getTrainingDetail, createTraining, refreshTraining, deleteTraining, updateTraining, importTrainingData, getProblemSetterOptions } from '../controllers/training.controller';
import { authMiddleware, roleMiddleware } from '../middlewares/auth.middleware'; // 假设你有权限中间件

const router = Router();

router.get('/', authMiddleware, getTrainings);
router.get('/problem-setter-options', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), getProblemSetterOptions);
router.get('/:id', authMiddleware, getTrainingDetail);
router.post('/', authMiddleware, roleMiddleware(['Teacher', 'Captain','Vice-Captain', 'Student-Coach']), createTraining);
router.post('/:id/refresh', authMiddleware, refreshTraining); // 刷新数据接口
router.delete('/:id', authMiddleware, roleMiddleware(['Teacher', 'Captain','Vice-Captain', 'Student-Coach']), deleteTraining);
router.put('/:id', authMiddleware, roleMiddleware(['Teacher', 'Captain','Vice-Captain', 'Student-Coach']), updateTraining);
router.post('/:id/import', authMiddleware, roleMiddleware(['Teacher', 'Captain','Vice-Captain', 'Student-Coach']), importTrainingData);

export default router;

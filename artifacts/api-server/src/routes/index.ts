import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import guildsRouter from "./guilds";
import clansRouter from "./clans";
import membersRouter from "./members";
import leaderboardRouter from "./leaderboard";
import submissionsRouter from "./submissions";
import warningsRouter from "./warnings";
import auditRouter from "./audit";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(guildsRouter);
router.use(clansRouter);
router.use(membersRouter);
router.use(leaderboardRouter);
router.use(submissionsRouter);
router.use(warningsRouter);
router.use(auditRouter);
router.use(statsRouter);

export default router;

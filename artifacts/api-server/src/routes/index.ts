import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clientsRouter from "./clients";
import filesRouter from "./files";
import loansRouter from "./loans";
import settingsRouter from "./settings";
import importsRouter from "./imports";
import trashRouter from "./trash";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clientsRouter);
router.use(filesRouter);
router.use(loansRouter);
router.use(settingsRouter);
router.use(importsRouter);
router.use(trashRouter);

export default router;

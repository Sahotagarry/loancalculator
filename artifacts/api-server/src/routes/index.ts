import { Router, type IRouter } from "express";
import clientsRouter from "./clients";
import filesRouter from "./files";
import loansRouter from "./loans";
import masterAgreementsRouter from "./master-agreements";
import settingsRouter from "./settings";
import importsRouter from "./imports";
import trashRouter from "./trash";
import rateResetsRouter from "./rate-resets";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(clientsRouter);
router.use(filesRouter);
router.use(loansRouter);
router.use(masterAgreementsRouter);
router.use(settingsRouter);
router.use(importsRouter);
router.use(trashRouter);
router.use(rateResetsRouter);
router.use(adminRouter);

export default router;

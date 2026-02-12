import { Router } from "express";

import { UserController } from "../../controllers/UserController";
import { AsyncTryCatch } from "../../utils/AsyncTryCatch";

const router = Router();

router.get("/", AsyncTryCatch(UserController.getUsers));
router.post("/", AsyncTryCatch(UserController.createUser));

export default router;

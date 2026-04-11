import { Router } from "express";

import { InternalAuthController } from "../../controllers/InternalAuthController";
import { RequireInternalApiKey } from "../../middlewares/InternalApiKeyMiddleware";
import { AsyncTryCatch } from "../../utils/AsyncTryCatch";

const router = Router();

router.use(RequireInternalApiKey);
router.post("/login-otp/create", AsyncTryCatch(InternalAuthController.createLoginOtp));
router.post("/login-otp/validate", AsyncTryCatch(InternalAuthController.validateLoginOtp));

export default router;

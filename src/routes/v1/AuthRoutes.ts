import { Router } from "express";

import { AuthController } from "../../controllers/AuthController";
import { AsyncTryCatch } from "../../utils/AsyncTryCatch";

const router = Router();

router.post("/signup", AsyncTryCatch(AuthController.signUp));
router.post("/signup/confirm", AsyncTryCatch(AuthController.confirmSignUp));
router.post("/phone/request-verification", AsyncTryCatch(AuthController.requestPhoneVerification));
router.post("/phone/confirm", AsyncTryCatch(AuthController.confirmPhoneVerification));
router.post("/registrations/:id/review", AsyncTryCatch(AuthController.reviewRegistration));
router.post("/login/initiate", AsyncTryCatch(AuthController.initiateLogin));
router.post("/login/respond", AsyncTryCatch(AuthController.respondToChallenge));
router.post("/forgot-password", AsyncTryCatch(AuthController.forgotPassword));
router.post("/forgot-password/confirm", AsyncTryCatch(AuthController.confirmForgotPassword));

export default router;

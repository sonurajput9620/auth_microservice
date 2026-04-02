import { Router } from "express";

import { RoleManagementController } from "../../controllers/RoleManagementController";
import {
  RequireAnyPermission,
  RequireAuth
} from "../../middlewares/AuthorizationMiddleware";
import { AsyncTryCatch } from "../../utils/AsyncTryCatch";

const router = Router();

router.get(
  "/bootstrap",
  RequireAuth,
  RequireAnyPermission("role-management.view", "roles.read"),
  AsyncTryCatch(RoleManagementController.getBootstrap)
);

export default router;

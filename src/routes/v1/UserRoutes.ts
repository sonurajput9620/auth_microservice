import { Router } from "express";

import { UserController } from "../../controllers/UserController";
import {
  RequireAnyPermission,
  RequireAuth
} from "../../middlewares/AuthorizationMiddleware";
import { AsyncTryCatch } from "../../utils/AsyncTryCatch";

const router = Router();

router.get(
  "/",
  RequireAuth,
  RequireAnyPermission("role-management.view", "roles.read"),
  AsyncTryCatch(UserController.getUsers)
);
router.post("/", AsyncTryCatch(UserController.createUser));
router.patch(
  "/:userId/role",
  RequireAuth,
  RequireAnyPermission("role-management.manage", "roles.write"),
  AsyncTryCatch(UserController.assignRole)
);
router.patch(
  "/:userId/status",
  RequireAuth,
  RequireAnyPermission("role-management.manage", "roles.write", "users-disable"),
  AsyncTryCatch(UserController.updateStatus)
);

export default router;

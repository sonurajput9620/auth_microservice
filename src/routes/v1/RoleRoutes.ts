import { Router } from "express";

import { RoleController } from "../../controllers/RoleController";
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
  AsyncTryCatch(RoleController.getRoles)
);
router.post(
  "/compare",
  RequireAuth,
  RequireAnyPermission("role-management.view", "roles.read"),
  AsyncTryCatch(RoleController.compareRoles)
);
router.get(
  "/:roleId",
  RequireAuth,
  RequireAnyPermission("role-management.view", "roles.read"),
  AsyncTryCatch(RoleController.getRoleById)
);
router.post(
  "/",
  RequireAuth,
  RequireAnyPermission("role-management.manage", "roles.write"),
  AsyncTryCatch(RoleController.createRole)
);
router.put(
  "/:roleId",
  RequireAuth,
  RequireAnyPermission("role-management.manage", "roles.write"),
  AsyncTryCatch(RoleController.updateRole)
);
router.delete(
  "/:roleId",
  RequireAuth,
  RequireAnyPermission("role-management.manage", "roles.write"),
  AsyncTryCatch(RoleController.deleteRole)
);
router.post(
  "/:roleId/duplicate",
  RequireAuth,
  RequireAnyPermission("role-management.manage", "roles.write"),
  AsyncTryCatch(RoleController.duplicateRole)
);

export default router;

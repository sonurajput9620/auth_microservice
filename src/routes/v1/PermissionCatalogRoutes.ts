import { Router } from "express";

import { PermissionCatalogController } from "../../controllers/PermissionCatalogController";
import {
  RequireAdmin,
  RequireAnyPermission,
  RequireAuth
} from "../../middlewares/AuthorizationMiddleware";
import { AsyncTryCatch } from "../../utils/AsyncTryCatch";

const router = Router();

router.get(
  "/",
  RequireAuth,
  RequireAnyPermission("role-management.view", "roles.read"),
  AsyncTryCatch(PermissionCatalogController.getCatalog)
);
router.get(
  "/export",
  RequireAuth,
  RequireAnyPermission("role-management.view", "roles.read"),
  AsyncTryCatch(PermissionCatalogController.exportCatalog)
);
router.post(
  "/import/validate",
  RequireAuth,
  RequireAdmin,
  AsyncTryCatch(PermissionCatalogController.validateImport)
);
router.post(
  "/import/:importId/apply",
  RequireAuth,
  RequireAdmin,
  AsyncTryCatch(PermissionCatalogController.applyImport)
);
router.post(
  "/restore-demo",
  RequireAuth,
  RequireAdmin,
  AsyncTryCatch(PermissionCatalogController.restoreDemo)
);
router.post(
  "/remap-roles",
  RequireAuth,
  RequireAdmin,
  AsyncTryCatch(PermissionCatalogController.remapRoles)
);

export default router;

import { Router } from "express";

import { RoleTemplateController } from "../../controllers/RoleTemplateController";
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
  AsyncTryCatch(RoleTemplateController.getTemplates)
);
router.post(
  "/",
  RequireAuth,
  RequireAnyPermission("role-management.manage", "roles.write"),
  AsyncTryCatch(RoleTemplateController.createTemplate)
);
router.delete(
  "/:templateId",
  RequireAuth,
  RequireAnyPermission("role-management.manage", "roles.write"),
  AsyncTryCatch(RoleTemplateController.deleteTemplate)
);
router.post(
  "/:templateId/apply-preview",
  RequireAuth,
  RequireAnyPermission("role-management.view", "roles.read"),
  AsyncTryCatch(RoleTemplateController.applyPreview)
);

export default router;

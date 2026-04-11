import { Router } from "express";

import authRoutes from "./AuthRoutes";
import internalAuthRoutes from "./InternalAuthRoutes";
import permissionCatalogRoutes from "./PermissionCatalogRoutes";
import roleManagementRoutes from "./RoleManagementRoutes";
import roleRoutes from "./RoleRoutes";
import roleTemplateRoutes from "./RoleTemplateRoutes";
import userRoutes from "./UserRoutes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/internal/auth", internalAuthRoutes);
router.use("/users", userRoutes);
router.use("/roles", roleRoutes);
router.use("/permission-catalog", permissionCatalogRoutes);
router.use("/role-management", roleManagementRoutes);
router.use("/role-templates", roleTemplateRoutes);

export default router;

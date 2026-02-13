import { Router } from "express";

import authRoutes from "./AuthRoutes";
import roleRoutes from "./RoleRoutes";
import userRoutes from "./UserRoutes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/roles", roleRoutes);

export default router;

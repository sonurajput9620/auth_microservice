import { Router } from "express";

import roleRoutes from "./RoleRoutes";
import userRoutes from "./UserRoutes";

const router = Router();

router.use("/users", userRoutes);
router.use("/roles", roleRoutes);

export default router;

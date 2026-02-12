import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Role routes are ready for implementation.",
    data: []
  });
});

export default router;

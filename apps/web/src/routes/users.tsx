import { createFileRoute } from "@tanstack/react-router";

import { UsersPage } from "@/features/admin/components/users-page";
import { guardFor } from "@/lib/auth/guards";

export const Route = createFileRoute("/users")({
  beforeLoad: guardFor("users.manage"),
  component: UsersPage,
});

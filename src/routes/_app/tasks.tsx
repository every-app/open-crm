import { createFileRoute } from "@tanstack/react-router";
import {
  TasksPage,
  tasksSearchSchema,
} from "@/client/features/tasks/TasksPage";

export const Route = createFileRoute("/_app/tasks")({
  validateSearch: tasksSearchSchema,
  component: TasksPage,
});
